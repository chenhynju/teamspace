import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, BusinessType } from '../audit/audit.service';
import { RealtimeEventsService } from '../realtime/realtime-events.service';

/**
 * 订阅生命周期执行者：周期性扫描到期订阅。
 *
 * 状态转换（支付渠道 / 本任务是唯一权威写入方）：
 *   ACTIVE ──账期到期、未取消──▶ PAST_DUE（保留权益进入 7 天宽限，模拟扣款失败）
 *   ACTIVE ──账期到期、cancelAtPeriodEnd──▶ CANCELED（立即降回 FREE）
 *   PAST_DUE ──超过宽限 7 天──▶ CANCELED（降回 FREE）
 */
const GRACE_DAYS = 7;
const FREE_PLAN_CODE = 'FREE';

export interface LifecycleSummary {
  scanned: number;
  pastDue: string[];
  canceled: string[];
}

@Injectable()
export class BillingLifecycleService {
  private readonly logger = new Logger(BillingLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'BillingLifecycleService_scheduledRun' })
  async scheduledRun(): Promise<void> {
    const summary = await this.run();
    if (summary.pastDue.length || summary.canceled.length) {
      this.logger.log(
        `订阅生命周期：PAST_DUE ${summary.pastDue.length}，CANCELED ${summary.canceled.length}`,
      );
    }
  }

  /** 执行一轮扫描（定时任务与平台超管手动触发共用） */
  async run(): Promise<LifecycleSummary> {
    const summary: LifecycleSummary = { scanned: 0, pastDue: [], canceled: [] };

    await this.prisma.withBillingMaintenance(async (tx) => {
      const now = new Date();
      const due = await tx.subscription.findMany({
        where: {
          OR: [
            { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
            { status: 'PAST_DUE' },
          ],
        },
      });
      summary.scanned = due.length;

      for (const sub of due) {
        const graceEnd = new Date(sub.currentPeriodEnd);
        graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);

        if (sub.status === 'ACTIVE' && !sub.cancelAtPeriodEnd && graceEnd > now) {
          // 进入宽限：扣款失败 → PAST_DUE，权益暂时保留
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: 'PAST_DUE' },
          });
          await this.audit.record(tx, {
            organizationId: sub.organizationId,
            actorId: null,
            title: '订阅生命周期',
            businessType: BusinessType.STATUS,
            action: 'billing:subscription_past_due',
            resourceType: 'Subscription',
            resourceId: sub.id,
            after: { status: 'PAST_DUE', graceUntil: graceEnd },
            traceId: 'cron:billing-lifecycle',
            requestMethod: 'CRON',
          });
          summary.pastDue.push(sub.organizationId);
          this.realtime.emitToOrg(sub.organizationId, 'billing:updated', {
            status: 'PAST_DUE',
          });
          continue;
        }

        // ACTIVE+取消到期，或 PAST_DUE 超宽限 → 终结并降回 FREE
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: 'CANCELED' },
        });
        const before = { planId: sub.planId, status: sub.status };
        await this.downgradeToFree(tx, sub.organizationId);
        await this.audit.record(tx, {
          organizationId: sub.organizationId,
          actorId: null,
          title: '订阅生命周期',
          businessType: BusinessType.STATUS,
          action: 'billing:subscription_canceled',
          resourceType: 'Subscription',
          resourceId: sub.id,
          before,
          after: { status: 'CANCELED', plan: FREE_PLAN_CODE },
          traceId: 'cron:billing-lifecycle',
          requestMethod: 'CRON',
        });
        summary.canceled.push(sub.organizationId);
        this.realtime.emitToOrg(sub.organizationId, 'billing:updated', {
          status: 'CANCELED',
          plan: FREE_PLAN_CODE,
        });
      }
    });

    return summary;
  }

  /** 降回 FREE：刷新组织 planId 与权益快照（保留不超过 FREE 额度的已用 AI 量） */
  private async downgradeToFree(tx: Prisma.TransactionClient, organizationId: string) {
    const freePlan = await tx.plan.findFirst({ where: { code: FREE_PLAN_CODE } });
    if (!freePlan) throw new Error('FREE 套餐缺失，无法降级');

    const existing = await tx.entitlement.findUnique({ where: { organizationId } });
    const aiUsed = Math.min(existing?.aiCreditsUsed ?? 0, freePlan.aiCredits);

    await tx.organization.update({
      where: { id: organizationId },
      data: { planId: freePlan.id },
    });
    await tx.entitlement.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId: freePlan.id,
        seatsIncluded: freePlan.seatsIncluded,
        aiCreditsTotal: freePlan.aiCredits,
        aiCreditsUsed: 0,
        maxProjects: freePlan.maxProjects,
        storageGb: freePlan.storageGb,
        features: freePlan.features as Prisma.InputJsonValue,
      },
      update: {
        planId: freePlan.id,
        seatsIncluded: freePlan.seatsIncluded,
        aiCreditsTotal: freePlan.aiCredits,
        aiCreditsUsed: aiUsed,
        maxProjects: freePlan.maxProjects,
        storageGb: freePlan.storageGb,
        features: freePlan.features as Prisma.InputJsonValue,
      },
    });
  }
}
