import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { AuditService, BusinessType } from '../audit/audit.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
  ) {}

  /** 当前组织详情（含套餐与成员数） */
  @Get('current')
  @UseGuards(OrgContextGuard)
  current(@CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: org.organizationId },
        include: {
          plan: true,
          entitlement: true,
          _count: { select: { memberships: true, workspaces: true, projects: true } },
        },
      });
      return { ...organization, roleKeys: org.roleKeys, perms: org.perms };
    });
  }

  /** 新建组织：当前用户作为 OWNER（用于一个账号拥有多个组织） */
  @Post()
  async create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    const created = await this.prisma.provision(async (tx) => {
      const baseSlug = this.prismaSlug(dto.name);
      const organization = await tx.organization.create({
        data: { name: dto.name, slug: `${baseSlug}-${nanoid(6).toLowerCase()}` },
      });

      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organization.id}, true)`;
      const roleMap = await this.provisioning.cloneTemplateRoles(tx, organization.id);
      const dept = await this.provisioning.createRootDept(tx, organization.id, dto.name, user.id);
      const membership = await tx.membership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          deptId: dept.id,
          status: 'ACTIVE',
        },
      });
      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: roleMap.get('OWNER')! },
      });
      await this.provisioning.applyPlan(tx, organization.id, 'FREE', 1);

      await this.audit.record(tx, {
        organizationId: organization.id,
        actorId: user.id,
        title: '组织管理',
        businessType: BusinessType.INSERT,
        action: 'org:create',
        resourceType: 'Organization',
        resourceId: organization.id,
        after: { name: dto.name },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      return organization;
    });

    return created;
  }

  /** 重命名当前组织 */
  @Patch()
  @UseGuards(OrgContextGuard)
  update(
    @Body() dto: UpdateOrganizationDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const before = await tx.organization.findUnique({
        where: { id: org.organizationId },
        select: { name: true },
      });
      const updated = await tx.organization.update({
        where: { id: org.organizationId },
        data: { name: dto.name },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: user.id,
        title: '组织管理',
        businessType: BusinessType.UPDATE,
        action: 'org:edit',
        resourceType: 'Organization',
        resourceId: org.organizationId,
        before,
        after: { name: updated.name },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      return updated;
    });
  }

  private prismaSlug(s: string): string {
    return (
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 32) || 'org'
    );
  }
}
