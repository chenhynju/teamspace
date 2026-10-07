import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TxClient } from '../../prisma/prisma.service';

/**
 * 组织开通：把系统模板角色克隆为组织角色，建立根部门与初始套餐权益。
 * 所有方法都在调用方事务内执行（注册用 prisma.provision，seed 用独立事务）。
 */
@Injectable()
export class ProvisioningService {
  /**
   * 将 organization_id IS NULL 的模板角色克隆为指定组织的角色（含 RoleMenu）。
   * 返回 模板 key -> 组织角色 id 的映射。
   */
  async cloneTemplateRoles(tx: TxClient, organizationId: string): Promise<Map<string, string>> {
    const templates = await tx.role.findMany({
      where: { organizationId: null },
      include: { menus: true },
      orderBy: { sort: 'asc' },
    });

    const keyToId = new Map<string, string>();
    for (const t of templates) {
      const created = await tx.role.create({
        data: {
          organizationId,
          name: t.name,
          key: t.key,
          sort: t.sort,
          dataScope: t.dataScope,
          menuCheckStrictly: t.menuCheckStrictly,
          deptCheckStrictly: t.deptCheckStrictly,
          status: t.status,
          remark: t.remark,
        },
      });
      keyToId.set(t.key, created.id);

      if (t.menus.length > 0) {
        await tx.roleMenu.createMany({
          data: t.menus.map((rm) => ({ roleId: created.id, menuId: rm.menuId })),
          skipDuplicates: true,
        });
      }
    }
    return keyToId;
  }

  /**
   * 创建组织的根部门（名称与组织一致）。
   */
  async createRootDept(
    tx: TxClient,
    organizationId: string,
    name: string,
    leaderUserId?: string,
  ): Promise<{ id: string }> {
    return tx.dept.create({
      data: {
        organizationId,
        name,
        ancestors: '',
        parentId: null,
        orderNum: 0,
        leader: leaderUserId,
        status: 'NORMAL',
      },
    });
  }

  /**
   * 按套餐初始化组织权益 + 订阅。
   */
  async applyPlan(
    tx: TxClient,
    organizationId: string,
    planCode: string,
    seats = 1,
  ): Promise<void> {
    const plan = await tx.plan.findFirst({ where: { code: planCode } });
    if (!plan) return;

    await tx.organization.update({
      where: { id: organizationId },
      data: { planId: plan.id },
    });

    await tx.entitlement.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId: plan.id,
        seatsIncluded: plan.seatsIncluded,
        aiCreditsTotal: plan.aiCredits,
        aiCreditsUsed: 0,
        maxProjects: plan.maxProjects,
        storageGb: plan.storageGb,
        features: plan.features as Prisma.InputJsonValue,
      },
      update: {},
    });

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await tx.subscription.create({
      data: {
        organizationId,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        seats,
        cancelAtPeriodEnd: false,
      },
    });
  }
}
