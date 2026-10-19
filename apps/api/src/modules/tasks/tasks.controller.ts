import type { Request } from 'express';
import { ResourceAccessGuard } from '../groups/resource-access.guard';
import { ResourcePolicyService } from '../groups/resource-policy.service';
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
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { RealtimeEventsService } from '../realtime/realtime-events.service';

class CreateTaskDto {
  @IsString()
  projectId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  priority?: number;
}

class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @IsIn(['TODO', 'IN_PROGRESS', 'DONE'])
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  priority?: number;
}

@Controller('tasks')
@UseGuards(OrgContextGuard, PermissionsGuard, ResourceAccessGuard)
export class TasksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeEventsService,
    private readonly resourcePolicy: ResourcePolicyService,
  ) {}

  @Get()
  @RequirePermissions('task:manage')
  list(@CurrentOrg() org: OrgContext, @Req() accessReq: Request, @Query('projectId') projectId?: string) {
    return this.prisma.withOrg(org.organizationId, (tx) =>
      tx.task.findMany({
        where: {
          organizationId: org.organizationId,
          projectId: { in: accessReq.accessibleProjectIds ?? [] },
          ...(projectId ? { projectId } : {}),
        },
        include: { assignee: { select: { id: true, name: true } } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
    );
  }

  @Post()
  @RequirePermissions('task:manage')
  create(@Body() dto: CreateTaskDto, @CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: dto.projectId, organizationId: org.organizationId },
      });
      if (!project) throw new BadRequestException({ code: 'PROJECT_INVALID', message: '项目不存在' });
      if (dto.assigneeId) await this.assertAssignee(tx, org.organizationId, project.id, dto.assigneeId);
      const task = await tx.task.create({
        data: {
          organizationId: org.organizationId,
          projectId: project.id,
          title: dto.title,
          description: dto.description,
          assigneeId: dto.assigneeId,
          priority: dto.priority ?? 2,
          status: 'TODO',
        },
      });
      this.realtime.emitToProject(org.organizationId, project.id, 'task:created', {
        taskId: task.id,
      });
      return task;
    });
  }

  @Patch(':id')
  @RequirePermissions('task:manage')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      if (dto.assigneeId) {
        const current = await tx.task.findFirstOrThrow({ where: { id, organizationId: org.organizationId } });
        await this.assertAssignee(tx, org.organizationId, current.projectId, dto.assigneeId);
      }
      const task = await tx.task.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          assigneeId: dto.assigneeId === null ? null : dto.assigneeId,
          status: dto.status as any,
          priority: dto.priority,
        },
      });
      this.realtime.emitToProject(org.organizationId, task.projectId, 'task:updated', {
        taskId: task.id,
      });
      return task;
    });
  }

  @Delete(':id')
  @RequirePermissions('task:manage')
  remove(@Param('id') id: string, @CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const existing = await tx.task.findUnique({ where: { id } });
      await tx.task.delete({ where: { id } });
      if (existing) {
        this.realtime.emitToProject(org.organizationId, existing.projectId, 'task:deleted', {
          taskId: id,
        });
      }
      return { deleted: true, id };
    });
  }

  private async assertAssignee(tx: any, orgId: string, projectId: string, userId: string) {
    const member = await tx.membership.findFirst({ where: { organizationId: orgId, userId, status: 'ACTIVE' } });
    if (!member) throw new BadRequestException({ code: 'ASSIGNEE_INVALID', message: '只能指派给本组织的有效成员' });
    await this.resourcePolicy.assert(tx, orgId, userId, projectId, 'READ');
  }
}
