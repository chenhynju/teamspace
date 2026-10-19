import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

class CreateWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

@Controller('workspaces')
@UseGuards(OrgContextGuard, PermissionsGuard)
export class WorkspacesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('workspace:list')
  list(@CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, (tx) =>
      tx.workspace.findMany({
        where: { organizationId: org.organizationId },
        include: { _count: { select: { projects: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  @Post()
  @RequirePermissions('workspace:add')
  create(
    @Body() dto: CreateWorkspaceDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          organizationId: org.organizationId,
          name: dto.name,
          description: dto.description,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: user.id,
        title: '工作区管理',
        businessType: BusinessType.INSERT,
        action: 'workspace:add',
        resourceType: 'Workspace',
        resourceId: ws.id,
        after: { name: ws.name },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      return ws;
    });
  }

  @Patch(':id')
  @RequirePermissions('workspace:edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const before = await tx.workspace.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      const updated = await tx.workspace.update({
        where: { id },
        data: { name: dto.name, description: dto.description },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: user.id,
        title: '工作区管理',
        businessType: BusinessType.UPDATE,
        action: 'workspace:edit',
        resourceType: 'Workspace',
        resourceId: id,
        before,
        after: updated,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      return updated;
    });
  }

  @Delete(':id')
  @RequirePermissions('workspace:remove')
  remove(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const before = await tx.workspace.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!before) {
        throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: '工作区不存在' });
      }
      // 非空保护：工作区内仍有项目时拒绝删除（项目会随级联被一并删除）
      const projectCount = await tx.project.count({ where: { workspaceId: id } });
      if (projectCount > 0) {
        throw new ConflictException({
          code: 'WORKSPACE_NOT_EMPTY',
          message: `工作区内还有 ${projectCount} 个项目，请先删除或移出项目`,
        });
      }
      await tx.workspace.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: user.id,
        title: '工作区管理',
        businessType: BusinessType.DELETE,
        action: 'workspace:remove',
        resourceType: 'Workspace',
        resourceId: id,
        before,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      return { deleted: true, id };
    });
  }
}
