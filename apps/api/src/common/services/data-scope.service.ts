import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TxClient } from '../../prisma/prisma.service';
import type { OrgContext } from '../decorators/current-org.decorator';

/**
 * 数据权限（对齐 RuoYi DataScopeAspect）：
 * 根据成员各角色的 data_scope 生成成员列表的行过滤条件，多角色取并集。
 *
 * 部门物化路径 ancestors 约定：根部门 ''，其余形如 ',rootId,parentId,'，
 * 因此“本部门及以下”用 ancestors 包含字面量 ',deptId,' 判定后代
 * （Prisma contains 是字面包含，不是 SQL LIKE，不能带 % 通配符）。
 */
@Injectable()
export class DataScopeService {
  async buildMembershipWhere(
    tx: TxClient,
    orgContext: OrgContext,
    currentUserId: string,
  ): Promise<Prisma.MembershipWhereInput> {
    if (orgContext.dataScopes.includes('ALL')) {
      return {};
    }

    // 加载成员各角色的自定义部门
    const membershipWithRoles = await tx.membership.findUnique({
      where: { id: orgContext.membershipId },
      include: { roles: { include: { role: { include: { depts: true } } } } },
    });

    const ors: Prisma.MembershipWhereInput[] = [];
    const customDeptIds = new Set<string>();

    for (const mr of membershipWithRoles?.roles ?? []) {
      const scope = mr.role.dataScope;
      if (scope === 'SELF') {
        ors.push({ userId: currentUserId });
      } else if (scope === 'DEPT' && orgContext.deptId) {
        ors.push({ deptId: orgContext.deptId });
      } else if (scope === 'DEPT_AND_CHILD' && orgContext.deptId) {
        const deptIds = await this.deptAndChildIds(tx, orgContext.organizationId, orgContext.deptId);
        ors.push({ deptId: { in: deptIds } });
      } else if (scope === 'CUSTOM') {
        for (const rd of mr.role.depts) customDeptIds.add(rd.deptId);
      }
    }

    if (customDeptIds.size > 0) {
      ors.push({ deptId: { in: [...customDeptIds] } });
    }

    if (ors.length === 0) {
      // 默认仅本人可见（fail-closed）
      return { userId: currentUserId };
    }
    return { OR: ors };
  }

  private async deptAndChildIds(
    tx: TxClient,
    organizationId: string,
    deptId: string,
  ): Promise<string[]> {
    // 物化路径以逗号分段，',deptId,' 只会在后代路径中整段命中，不会误伤 ID 前缀
    const like = `,${deptId},`;
    const depts = await tx.dept.findMany({
      where: {
        organizationId,
        OR: [{ id: deptId }, { ancestors: { contains: like } }],
      },
      select: { id: true },
    });
    return depts.map((d) => d.id);
  }
}
