import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DataScopeService } from '../../common/services/data-scope.service';
import { AuditService, BusinessType } from '../audit/audit.service';
import {
  IsString,
  IsArray,
  ArrayNotEmpty,
  IsOptional,
} from 'class-validator';

class UpdateMemberDto {
  @IsOptional()
  @IsString()
  deptId?: string;
}

class AssignRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roleIds: string[];
}

class AssignPostsDto {
  @IsArray()
  @IsString({ each: true })
  postIds: string[];
}

@Controller('members')
@UseGuards(OrgContextGuard, PermissionsGuard)
export class MembershipsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  /** 成员列表：按数据权限过滤部门/本人 */
  @Get()
  @RequirePermissions('member:list')
  list(@CurrentOrg() org: OrgContext, @CurrentUser() me: { id: string }) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const scopeWhere = await this.dataScope.buildMembershipWhere(tx, org, me.id);
      return tx.membership.findMany({
        where: { AND: [{ organizationId: org.organizationId }, scopeWhere] },
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true, status: true } },
          dept: { select: { id: true, name: true } },
          roles: { include: { role: { select: { id: true, key: true, name: true } } } },
          posts: { include: { post: { select: { id: true, name: true, code: true } } } },
        },
        orderBy: { joinedAt: 'asc' },
      });
    });
  }

  /** 成员详情 */
  @Get(':id')
  @RequirePermissions('member:list')
  detail(@Param('id') id: string, @CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, (tx) =>
      tx.membership.findFirst({
        where: { id, organizationId: org.organizationId },
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          dept: true,
          roles: { include: { role: true } },
          posts: { include: { post: true } },
        },
      }),
    );
  }

  /** 调整成员所属部门 */
  @Patch(':id')
  @RequirePermissions('member:edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMemberDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const before = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId },
        select: { deptId: true },
      });
      const updated = await tx.membership.update({
        where: { id },
        data: { deptId: dto.deptId ?? null },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '成员管理',
        businessType: BusinessType.UPDATE,
        action: 'member:edit',
        resourceType: 'Membership',
        resourceId: id,
        before,
        after: { deptId: updated.deptId },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      return updated;
    });
  }

  /** 分配角色（全量覆盖）；保护最后一个 OWNER */
  @Post(':id/roles')
  @RequirePermissions('member:assign-role')
  async assignRoles(
    @Param('id') id: string,
    @Body() dto: AssignRolesDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId },
        include: { roles: { include: { role: true } } },
      });
      if (!target) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: '成员不存在' });
      }

      // 校验角色均属于当前组织（RLS 已隔离，这里再确认数量）
      const roles = await tx.role.findMany({ where: { id: { in: dto.roleIds } } });
      if (roles.length !== new Set(dto.roleIds).size) {
        throw new BadRequestException({ code: 'ROLE_INVALID', message: '存在不属于当前组织的角色' });
      }

      const beforeKeys = target.roles.map((r) => r.role.key);
      const afterKeys = roles.map((r) => r.key);
      // 若剥夺最后一个有效 OWNER，则拒绝
      if (beforeKeys.includes('OWNER') && !afterKeys.includes('OWNER')) {
        await this.assertAnotherActiveOwner(tx, org.organizationId, id);
      }

      await tx.membershipRole.deleteMany({ where: { membershipId: id } });
      if (dto.roleIds.length) {
        await tx.membershipRole.createMany({
          data: dto.roleIds.map((roleId) => ({ membershipId: id, roleId })),
          skipDuplicates: true,
        });
      }

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '成员管理',
        businessType: BusinessType.GRANT,
        action: 'member:assign-role',
        resourceType: 'Membership',
        resourceId: id,
        before: { roleKeys: beforeKeys },
        after: { roleKeys: afterKeys },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      return { membershipId: id, roleIds: dto.roleIds };
    });
  }

  /** 分配岗位（全量覆盖） */
  @Post(':id/posts')
  @RequirePermissions('member:edit')
  async assignPosts(
    @Param('id') id: string,
    @Body() dto: AssignPostsDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const posts = await tx.post.findMany({ where: { id: { in: dto.postIds } } });
      if (posts.length !== new Set(dto.postIds).size) {
        throw new BadRequestException({ code: 'POST_INVALID', message: '存在不属于当前组织的岗位' });
      }
      await tx.membershipPost.deleteMany({ where: { membershipId: id } });
      if (dto.postIds.length) {
        await tx.membershipPost.createMany({
          data: dto.postIds.map((postId) => ({ membershipId: id, postId })),
          skipDuplicates: true,
        });
      }
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '成员管理',
        businessType: BusinessType.GRANT,
        action: 'member:edit-post',
        resourceType: 'Membership',
        resourceId: id,
        after: { postIds: dto.postIds },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return { membershipId: id, postIds: dto.postIds };
    });
  }

  /** 暂停成员：立即失效其组织访问（守卫每次校验 membership 状态） */
  @Post(':id/suspend')
  @RequirePermissions('member:remove')
  suspend(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      await this.assertNotLastOwner(tx, org.organizationId, id);
      const updated = await tx.membership.update({
        where: { id },
        data: { status: 'SUSPENDED' },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '成员管理',
        businessType: BusinessType.STATUS,
        action: 'member:suspend',
        resourceType: 'Membership',
        resourceId: id,
        before: { status: 'ACTIVE' },
        after: { status: updated.status },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return updated;
    });
  }

  /** 恢复成员 */
  @Post(':id/reactivate')
  @RequirePermissions('member:remove')
  reactivate(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const updated = await tx.membership.update({
        where: { id },
        data: { status: 'ACTIVE' },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '成员管理',
        businessType: BusinessType.STATUS,
        action: 'member:reactivate',
        resourceType: 'Membership',
        resourceId: id,
        before: { status: 'SUSPENDED' },
        after: { status: updated.status },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return updated;
    });
  }

  /** 移除成员（软删除 status=REMOVED，立即生效） */
  @Delete(':id')
  @RequirePermissions('member:remove')
  remove(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      await this.assertNotLastOwner(tx, org.organizationId, id);
      const updated = await tx.membership.update({
        where: { id },
        data: { status: 'REMOVED' },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '成员管理',
        businessType: BusinessType.STATUS,
        action: 'member:remove',
        resourceType: 'Membership',
        resourceId: id,
        before: { status: 'ACTIVE' },
        after: { status: updated.status },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return updated;
    });
  }

  /** 目标若是最后一个有效 OWNER 则拒绝（暂停/移除前） */
  private async assertNotLastOwner(tx: any, organizationId: string, membershipId: string) {
    const target = await tx.membership.findUnique({
      where: { id: membershipId },
      include: { roles: { include: { role: true } } },
    });
    if (!target || !target.roles.some((r: any) => r.role.key === 'OWNER')) return;
    await this.assertAnotherActiveOwner(tx, organizationId, membershipId);
  }

  private async assertAnotherActiveOwner(
    tx: any,
    organizationId: string,
    excludeMembershipId: string,
  ) {
    const count = await tx.membership.count({
      where: {
        organizationId,
        status: 'ACTIVE',
        id: { not: excludeMembershipId },
        roles: { some: { role: { key: 'OWNER' } } },
      },
    });
    if (count < 1) {
      throw new ConflictException({
        code: 'LAST_OWNER',
        message: '不能删除或停用最后一个有效负责人（OWNER）',
      });
    }
  }
}
