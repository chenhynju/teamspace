import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, TxClient } from '../../prisma/prisma.service';

export type ResourceAction = 'READ' | 'WRITE' | 'MANAGE';
const rank: Record<ResourceAction, number> = { READ: 1, WRITE: 2, MANAGE: 3 };

/** Resource adapters expose a stable can(subject, action, resource) contract.
 * Project is the first adapter; tasks/files inherit its policy. Group kind is descriptive, never authority.
 */
@Injectable()
export class ResourcePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async accessible(tx: TxClient, orgId: string, userId: string, action: ResourceAction = 'READ'): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM prj_project p
      JOIN org_membership m ON m.organization_id = p.organization_id AND m.user_id = ${userId} AND m.status = 'ACTIVE'
      WHERE p.organization_id = ${orgId} AND (
        p.owner_id = ${userId}
        OR (p.visibility = 'ORGANIZATION' AND ${action} <> 'MANAGE')
        OR EXISTS (SELECT 1 FROM org_membership_role mr JOIN sys_role r ON r.id = mr.role_id
                   WHERE mr.membership_id = m.id AND r.status = 'NORMAL' AND r.role_key IN ('OWNER','ADMIN'))
        OR EXISTS (SELECT 1 FROM org_resource_grant g
                   JOIN org_collaboration_group u ON u.id = g.group_id AND u.organization_id = p.organization_id
                   JOIN org_group_member gm ON gm.group_id = u.id AND gm.membership_id = m.id
                   WHERE g.project_id = p.id AND g.organization_id = p.organization_id AND u.archived_at IS NULL
                   AND CASE g.access WHEN 'READ' THEN 1 WHEN 'WRITE' THEN 2 WHEN 'MANAGE' THEN 3 ELSE 0 END >= ${rank[action]})
      )`;
    return rows.map(p => p.id);
  }

  async assert(tx: TxClient, orgId: string, userId: string, projectId: string, action: ResourceAction = 'READ') {
    if (!(await this.accessible(tx, orgId, userId, action)).includes(projectId)) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '项目不存在或没有访问权限' });
  }

  async socketAllowed(orgId: string, userId: string, projectId: string) {
    return this.prisma.withOrg(orgId, async tx => (await this.accessible(tx, orgId, userId)).includes(projectId));
  }

  async assertGroupManager(tx: TxClient, orgId: string, userId: string, groupId?: string) {
    const member = await tx.membership.findFirst({ where: { organizationId: orgId, userId, status: 'ACTIVE' }, include: { roles: { include: { role: true } }, groupMemberships: true } });
    const admin = member?.roles.some(r => ['OWNER','ADMIN'].includes(r.role.key) && r.role.status === 'NORMAL');
    if (!admin && !(groupId && member?.groupMemberships.some(g => g.groupId === groupId && g.role === 'MANAGER'))) throw new ForbiddenException({ code: 'GROUP_MANAGE_DENIED', message: '需要组织管理员或协作单元负责人权限' });
    return member!;
  }
}
