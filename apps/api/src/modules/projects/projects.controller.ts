import { ResourceAccessGuard } from '../groups/resource-access.guard';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { RealtimeEventsService } from '../realtime/realtime-events.service';

@Controller('projects')
@UseGuards(OrgContextGuard, PermissionsGuard, ResourceAccessGuard)
export class ProjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  @Get()
  @RequirePermissions('project:list')
  list(
    @CurrentOrg() org: OrgContext,
    @Req() accessReq: Request,
    @Query('workspaceId') workspaceId?: string,
    @Query('status') status?: string,
  ) {
    return this.prisma.withOrg(org.organizationId, (tx) =>
      tx.project.findMany({
        where: {
          organizationId: org.organizationId,
          id: { in: accessReq.accessibleProjectIds ?? [] },
          ...(workspaceId ? { workspaceId } : {}),
          ...(status ? { status: status as any } : {}),
        },
        include: {
          workspace: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
          _count: { select: { tasks: true, files: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }

  @Get(':id')
  @RequirePermissions('project:query')
  async detail(@Param('id') id: string, @CurrentOrg() org: OrgContext) {
    const project = await this.prisma.withOrg(org.organizationId, (tx) =>
      tx.project.findFirst({
        where: { id, organizationId: org.organizationId },
        include: {
          workspace: true,
          owner: { select: { id: true, name: true, email: true } },
          tasks: { orderBy: { createdAt: 'desc' } },
          files: { orderBy: { createdAt: 'desc' } },
        },
      }),
    );
    if (!project) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '项目不存在或已删除' });
    }
    // File.size 为 BigInt，JSON 序列化前转字符串
    return {
      ...project,
      files: project.files.map(({ size, ...f }) => ({ ...f, size: size.toString() })),
    };
  }

  @Post()
  @RequirePermissions('project:add')
  create(
    @Body() dto: CreateProjectDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      // 工作区必须属于当前组织
      const workspace = await tx.workspace.findFirst({
        where: { id: dto.workspaceId, organizationId: org.organizationId },
      });
      if (!workspace) {
        throw new BadRequestException({ code: 'WORKSPACE_INVALID', message: '工作区不存在' });
      }

      // 项目数配额（排除 ARCHIVED）
      const entitlement = await tx.entitlement.findUnique({
        where: { organizationId: org.organizationId },
      });
      if (entitlement && entitlement.maxProjects >= 0) {
        const activeCount = await tx.project.count({
          where: {
            organizationId: org.organizationId,
            status: { not: 'ARCHIVED' },
          },
        });
        if (activeCount >= entitlement.maxProjects) {
          throw new ConflictException({
            code: 'PROJECT_LIMIT',
            message: `已达套餐项目数上限（${entitlement.maxProjects}），请升级套餐`,
          });
        }
      }

      const project = await tx.project.create({
        data: {
          organizationId: org.organizationId,
          workspaceId: workspace.id,
          ownerId: me.id,
          name: dto.name,
          description: dto.description,
          status: 'DRAFT',
        },
      });

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '项目管理',
        businessType: BusinessType.INSERT,
        action: 'project:add',
        resourceType: 'Project',
        resourceId: project.id,
        after: { name: project.name, status: project.status },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      this.realtime.emitToOrg(org.organizationId, 'project:created', {
        projectId: project.id,
        name: project.name,
      });
      return project;
    });
  }

  @Patch(':id')
  @RequirePermissions('project:edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const updated = await tx.project.update({
        where: { id },
        data: { name: dto.name, description: dto.description },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '项目管理',
        businessType: BusinessType.UPDATE,
        action: 'project:edit',
        resourceType: 'Project',
        resourceId: id,
        after: updated,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'PATCH',
      });
      this.realtime.emitToProject(org.organizationId, id, 'project:updated', {
        projectId: id,
        by: { userId: me.id },
      });
      return updated;
    });
  }

  // ---------- 状态机 ----------

  @Post(':id/activate')
  @RequirePermissions('project:edit')
  activate(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.transition(id, org, me.id, req, {
      from: 'DRAFT',
      to: 'ACTIVE',
      action: 'project:activate',
    });
  }

  @Post(':id/deliver')
  @RequirePermissions('project:deliver')
  deliver(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.transition(id, org, me.id, req, {
      from: 'ACTIVE',
      to: 'DELIVERED',
      action: 'project:deliver',
    });
  }

  @Post(':id/archive')
  @RequirePermissions('project:edit')
  archive(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.transition(id, org, me.id, req, {
      from: ['ACTIVE', 'DELIVERED'],
      to: 'ARCHIVED',
      action: 'project:archive',
    });
  }

  @Delete(':id')
  @RequirePermissions('project:remove')
  remove(
    @Param('id') id: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const before = await tx.project.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!before) return { deleted: false };
      if (before.status !== 'DRAFT') {
        throw new ConflictException({
          code: 'PROJECT_NOT_DELETABLE',
          message: '仅草稿状态项目可删除，其他状态请归档',
        });
      }
      await tx.project.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '项目管理',
        businessType: BusinessType.DELETE,
        action: 'project:remove',
        resourceType: 'Project',
        resourceId: id,
        before,
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'DELETE',
      });
      this.realtime.emitToOrg(org.organizationId, 'project:deleted', { projectId: id });
      return { deleted: true, id };
    });
  }

  private transition(
    id: string,
    org: OrgContext,
    actorId: string,
    req: Request,
    spec: { from: string | string[]; to: string; action: string },
  ) {
    const allowedFrom = Array.isArray(spec.from) ? spec.from : [spec.from];
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const before = await tx.project.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!before) throw new BadRequestException({ code: 'NOT_FOUND', message: '项目不存在' });
      if (!allowedFrom.includes(before.status)) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `项目当前状态 ${before.status} 不允许此操作（需 ${allowedFrom.join('/')}）`,
        });
      }
      const updated = await tx.project.update({
        where: { id },
        data: { status: spec.to as any },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId,
        title: '项目管理',
        businessType: BusinessType.STATUS,
        action: spec.action,
        resourceType: 'Project',
        resourceId: id,
        before: { status: before.status },
        after: { status: updated.status },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });
      this.realtime.emitToProject(org.organizationId, id, 'project:updated', {
        projectId: id,
        status: updated.status,
      });
      return updated;
    });
  }
}
