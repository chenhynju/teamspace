import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TxClient } from '../../prisma/prisma.service';

/**
 * Webhook 归一化摄入服务（适配器模式的业务层）。
 * 控制器/渠道适配器只负责验签并把渠道事件转成统一 WebhookDto，
 * 这里负责：幂等落流水 → 按归一化类型在同一事务内施加副作用。
 * 新增事件类型只需在 EFFECT_HANDLERS 注册，不必改动控制器。
 */

export interface IngestResult {
  duplicate?: boolean;
  applied: string | null;
  ignored?: boolean;
}

type EffectHandler = (
  tx: TxClient,
  organizationId: string,
  payload: Record<string, unknown>,
) => Promise<string>;

const EFFECT_HANDLERS: Record<string, EffectHandler> = {
  // 授予额外 AI 额度（营销活动/补偿/充值包）
  'entitlement.grant_ai_credits': async (tx, organizationId, payload) => {
    const amount = Number(payload.amount) || 0;
    if (amount <= 0) throw new Error('amount 必须为正数');
    await tx.entitlement.update({
      where: { organizationId },
      data: { aiCreditsTotal: { increment: amount } },
    });
    return `ai_credits+${amount}`;
  },

  // 席位变更（渠道侧加购/减少席位）
  'plan.seats_update': async (tx, organizationId, payload) => {
    const seats = Number(payload.seatsIncluded) || 0;
    await tx.entitlement.update({
      where: { organizationId },
      data: { seatsIncluded: seats },
    });
    return `seats=${seats}`;
  },

  // 订阅状态同步：以渠道为权威，刷新订阅状态/账期/席位
  'subscription.activated': async (tx, organizationId, payload) =>
    syncSubscription(tx, organizationId, 'ACTIVE', payload),
  'subscription.past_due': async (tx, organizationId, payload) =>
    syncSubscription(tx, organizationId, 'PAST_DUE', payload),
  'subscription.canceled': async (tx, organizationId, payload) =>
    syncSubscription(tx, organizationId, 'CANCELED', payload),
};

async function syncSubscription(
  tx: TxClient,
  organizationId: string,
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED',
  payload: Record<string, unknown>,
): Promise<string> {
  const latest = await tx.subscription.findFirst({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) {
    // 无本地订阅记录时不盲目创建（缺 planId），记录但忽略
    return `subscription_status=${status} (no local subscription, ignored)`;
  }

  const data: Prisma.SubscriptionUpdateInput = { status };
  if (payload.currentPeriodEnd) {
    const end = new Date(String(payload.currentPeriodEnd));
    if (!Number.isNaN(end.getTime())) data.currentPeriodEnd = end;
  }
  const seats = Number(payload.seats);
  if (Number.isFinite(seats) && seats > 0) data.seats = seats;
  if (typeof payload.cancelAtPeriodEnd === 'boolean') {
    data.cancelAtPeriodEnd = payload.cancelAtPeriodEnd;
  }
  await tx.subscription.update({ where: { id: latest.id }, data });
  return `subscription_status=${status}`;
}

@Injectable()
export class WebhookIngestService {
  private readonly logger = new Logger(WebhookIngestService.name);

  /** 在调用方事务内幂等摄入事件；重复事件不重复施加任何副作用 */
  async ingest(
    tx: TxClient,
    dto: {
      organizationId: string;
      provider: string;
      eventId: string;
      type: string;
      payload: Record<string, unknown>;
    },
  ): Promise<IngestResult> {
    try {
      await tx.billingEvent.create({
        data: {
          organizationId: dto.organizationId,
          provider: dto.provider,
          eventId: dto.eventId,
          type: dto.type,
          payload: dto.payload as Prisma.InputJsonValue,
          processed: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { duplicate: true, applied: null };
      }
      throw e;
    }

    const handler = EFFECT_HANDLERS[dto.type];
    if (!handler) {
      // 未知事件：流水已留存，标记未深度处理但不算错误
      await tx.billingEvent.updateMany({
        where: { provider: dto.provider, eventId: dto.eventId },
        data: { processed: false },
      });
      this.logger.warn(`未识别的计费事件类型：${dto.type}`);
      return { applied: null, ignored: true };
    }

    const applied = await handler(tx, dto.organizationId, dto.payload ?? {});
    return { applied };
  }
}
