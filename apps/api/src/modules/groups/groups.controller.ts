import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';
import { ResourcePolicyService } from './resource-policy.service';

class GroupDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsIn(['TEAM','DEPARTMENT','CLIENT','COMMUNITY']) kind: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}
class MemberDto {
  @IsString() membershipId: string;
  @IsIn(['MEMBER','MANAGER']) role: string;
}
class GrantDto {
  @IsString() projectId: string;
  @IsIn(['READ','WRITE','MANAGE']) access: string;
}
class VisibilityDto { @IsIn(['ORGANIZATION','RESTRICTED']) visibility: string; }

@Controller('groups')
@UseGuards(OrgContextGuard)
export class GroupsController {
  constructor(private readonly prisma: PrismaService, private readonly policy: ResourcePolicyService, private readonly audit: AuditService) {}

  @Get()
  list(@CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, tx => tx.collaborationGroup.findMany({ where: { organizationId: org.organizationId }, include: { members: { include: { membership: { include: { user: { select: { id: true, name: true } } } } } }, grants: true }, orderBy: { name: 'asc' } }));
  }

  @Post()
  create(@Body() dto: GroupDto, @CurrentOrg() org: OrgContext, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.prisma.withOrg(org.organizationId, async tx => {
      const member = await this.policy.assertGroupManager(tx, org.organizationId, user.id);
      const group = await tx.collaborationGroup.create({ data: { ...dto, organizationId: org.organizationId } });
      await tx.groupMember.create({ data: { organizationId: org.organizationId, groupId: group.id, membershipId: member.id, role: 'MANAGER' } });
      await this.audit.record(tx, { organizationId: org.organizationId, actorId: user.id, title: '协作单元', action: 'group:create', resourceType: 'CollaborationGroup', resourceId: group.id, businessType: BusinessType.INSERT, after: dto, traceId: req.traceId });
      return group;
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: GroupDto, @CurrentOrg() org: OrgContext, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.change(id, org, user.id, req, tx => tx.collaborationGroup.update({ where: { id }, data: dto }));
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentOrg() org: OrgContext, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.change(id, org, user.id, req, tx => tx.collaborationGroup.update({ where: { id }, data: { archivedAt: new Date() } }));
  }

  @Post(':id/members')
  member(@Param('id') id: string, @Body() dto: MemberDto, @CurrentOrg() org: OrgContext, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.change(id, org, user.id, req, async tx => {
      const member = await tx.membership.findFirst({ where: { id: dto.membershipId, organizationId: org.organizationId, status: 'ACTIVE' } });
      if (!member) throw new BadRequestException('只能添加当前组织的有效成员');
      const existing = await tx.groupMember.findUnique({ where: { groupId_membershipId: { groupId: id, membershipId: member.id } } });
      if (existing?.role === 'MANAGER' && dto.role !== 'MANAGER') await this.lastManager(tx, id, org.organizationId);
      return tx.groupMember.upsert({ where: { groupId_membershipId: { groupId: id, membershipId: member.id } }, create: { organizationId: org.organizationId, groupId: id, ...dto }, update: { role: dto.role } });
    });
  }

  @Delete(':id/members/:membershipId')
  removeMember(@Param('id') id: string, @Param('membershipId') membershipId: string, @CurrentOrg() org: OrgContext, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.change(id, org, user.id, req, async tx => {
      const existing = await tx.groupMember.findUnique({ where: { groupId_membershipId: { groupId: id, membershipId } } });
      if (existing?.role === 'MANAGER') await this.lastManager(tx, id, org.organizationId);
      await tx.groupMember.deleteMany({ where: { organizationId: org.organizationId, groupId: id, membershipId } });
      return { removed: true };
    });
  }

  @Post(':id/grants')
  grant(@Param('id') id: string, @Body() dto: GrantDto, @CurrentOrg() org: OrgContext, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.change(id, org, user.id, req, async tx => {
      await this.policy.assert(tx, org.organizationId, user.id, dto.projectId, 'MANAGE');
      return tx.resourceGrant.upsert({ where: { groupId_projectId: { groupId: id, projectId: dto.projectId } }, create: { organizationId: org.organizationId, groupId: id, ...dto }, update: { access: dto.access } });
    });
  }

  @Delete(':id/grants/:projectId')
  revoke(@Param('id') id: string, @Param('projectId') projectId: string, @CurrentOrg() org: OrgContext, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.change(id, org, user.id, req, async tx => {
      await this.policy.assert(tx, org.organizationId, user.id, projectId, 'MANAGE');
      await tx.resourceGrant.deleteMany({ where: { organizationId: org.organizationId, groupId: id, projectId } });
      return { revoked: true };
    });
  }

  @Patch('resources/projects/:projectId')
  visibility(@Param('projectId') projectId: string, @Body() dto: VisibilityDto, @CurrentOrg() org: OrgContext, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.prisma.withOrg(org.organizationId, async tx => {
      await this.policy.assert(tx, org.organizationId, user.id, projectId, 'MANAGE');
      const before = await tx.project.findFirstOrThrow({ where: { id: projectId, organizationId: org.organizationId } });
      if (before.ownerId !== user.id && !org.roleKeys.some(r => ['OWNER','ADMIN'].includes(r))) throw new BadRequestException('只有项目负责人或组织管理员可变更可见性');
      const project = await tx.project.update({ where: { id: projectId }, data: dto });
      await this.audit.record(tx, { organizationId: org.organizationId, actorId: user.id, title: '资源访问', action: 'resource:visibility', resourceType: 'Project', resourceId: projectId, before: { visibility: before.visibility }, after: dto, traceId: req.traceId });
      return project;
    });
  }

  private async lastManager(tx: any, groupId: string, organizationId: string) {
    if (await tx.groupMember.count({ where: { organizationId, groupId, role: 'MANAGER', membership: { status: 'ACTIVE' } } }) <= 1) throw new ConflictException({ code: 'LAST_GROUP_MANAGER', message: '请先指定另一名有效负责人' });
  }

  private change(id: string, org: OrgContext, userId: string, req: Request, fn: (tx: any) => Promise<any>) {
    return this.prisma.withOrg(org.organizationId, async tx => {
      await tx.$executeRaw`SELECT id FROM org_collaboration_group WHERE id = ${id} AND organization_id = ${org.organizationId} FOR UPDATE`;
      const before = await tx.collaborationGroup.findFirst({ where: { id, organizationId: org.organizationId } });
      if (!before) throw new NotFoundException('协作单元不存在');
      await this.policy.assertGroupManager(tx, org.organizationId, userId, id);
      if (before.archivedAt) throw new ConflictException('该协作单元已归档');
      const result = await fn(tx);
      await this.audit.record(tx, { organizationId: org.organizationId, actorId: userId, title: '协作单元', action: `${req.method}:${req.route.path}`, resourceType: 'CollaborationGroup', resourceId: id, before, after: result, traceId: req.traceId });
      return result;
    });
  }
}
