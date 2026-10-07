import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextGuard } from '../../common/guards/org-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg, OrgContext } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService, BusinessType } from '../audit/audit.service';
import { SubscribeDto, WebhookDto } from './dto/billing.dto';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookIngestService } from './webhook-ingest.service';
import { BillingLifecycleService } from './billing-lifecycle.service';
import { RealtimeEventsService } from '../realtime/realtime-events.service';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly ingest: WebhookIngestService,
    private readonly lifecycle: BillingLifecycleService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /** 可购套餐（全局） */
  @Public()
  @Get('plans')
  plans() {
    return this.prisma.plan.findMany({
      where: { status: 'NORMAL' },
      orderBy: { priceMonthly: 'asc' },
    });
  }

  /** 计费总览：订阅/权益/当前已用席位（仅计 ACTIVE） */
  @Get('overview')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('billing:view')
  overview(@CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const [organization, entitlement, activeSeats, subscription] = await Promise.all([
        tx.organization.findUnique({
          where: { id: org.organizationId },
          include: { plan: true },
        }),
        tx.entitlement.findUnique({ where: { organizationId: org.organizationId } }),
        tx.membership.count({
          where: { organizationId: org.organizationId, status: 'ACTIVE' },
        }),
        tx.subscription.findFirst({
          where: { organizationId: org.organizationId, status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      return { organization, entitlement, subscription, activeSeats };
    });
  }

  /** 事件列表（计费管理） */
  @Get('events')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('billing:manage')
  events(@CurrentOrg() org: OrgContext) {
    return this.prisma.withOrg(org.organizationId, (tx) =>
      tx.billingEvent.findMany({
        where: { organizationId: org.organizationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }

  /**
   * 沙盒内变更套餐（内部模拟，不产生真实支付）。
   * 成功后刷新权益快照并新建订阅；服务替身：仅在沙盒环境有效。
   */
  @Post('subscribe')
  @UseGuards(OrgContextGuard, PermissionsGuard)
  @RequirePermissions('billing:change')
  subscribe(
    @Body() dto: SubscribeDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() me: { id: string },
    @Req() req: Request,
  ) {
    return this.prisma.withOrg(org.organizationId, async (tx) => {
      const plan = await tx.plan.findFirst({ where: { code: dto.planCode } });
      if (!plan) throw new BadRequestException({ code: 'PLAN_INVALID', message: '套餐不存在' });

      const activeSeats = await tx.membership.count({
        where: { organizationId: org.organizationId, status: 'ACTIVE' },
      });

      // 刷新权益快照（保留已用 AI 额度）
      const existing = await tx.entitlement.findUnique({
        where: { organizationId: org.organizationId },
      });
      const aiUsed = Math.min(existing?.aiCreditsUsed ?? 0, plan.aiCredits);
      await tx.entitlement.upsert({
        where: { organizationId: org.organizationId },
        create: {
          organizationId: org.organizationId,
          planId: plan.id,
          seatsIncluded: plan.seatsIncluded,
          aiCreditsTotal: plan.aiCredits,
          aiCreditsUsed: 0,
          maxProjects: plan.maxProjects,
          storageGb: plan.storageGb,
          features: plan.features as Prisma.InputJsonValue,
        },
        update: {
          planId: plan.id,
          seatsIncluded: plan.seatsIncluded,
          aiCreditsTotal: plan.aiCredits,
          aiCreditsUsed: aiUsed,
          maxProjects: plan.maxProjects,
          storageGb: plan.storageGb,
          features: plan.features as Prisma.InputJsonValue,
        },
      });

      // 旧订阅置为取消，建立新订阅
      await tx.subscription.updateMany({
        where: { organizationId: org.organizationId, status: 'ACTIVE' },
        data: { status: 'CANCELED' },
      });
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + (dto.interval === 'yearly' ? 12 : 1));
      await tx.subscription.create({
        data: {
          organizationId: org.organizationId,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          seats: Math.max(activeSeats, 1),
        },
      });
      await tx.organization.update({
        where: { id: org.organizationId },
        data: { planId: plan.id },
      });

      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actorId: me.id,
        title: '套餐管理',
        businessType: BusinessType.UPDATE,
        action: 'billing:change',
        resourceType: 'Plan',
        resourceId: plan.id,
        after: { planCode: plan.code, seats: Math.max(activeSeats, 1) },
        traceId: req.traceId,
        ip: req.ip,
        requestMethod: 'POST',
      });

      this.realtime.emitToOrg(org.organizationId, 'billing:updated', {
        planCode: plan.code,
      });
      return { changed: true, planCode: plan.code, activeSeats };
    });
  }

  /**
   * 支付/权益事件 webhook（公开端点，但必须验签，杜绝匿名刷权益）。
   * 签名方案对齐 Stripe：header `x-webhook-signature: t=<unix>,v1=<hmac>`，
   * HMAC-SHA256 对 `${t}.${rawBody}` 计算；时间戳超过 5 分钟拒绝（防重放）。
   * 沙盒用 BILLING_WEBHOOK_SECRET；真实接入 Stripe 时改用其官方 SDK + STRIPE_WEBHOOK_SECRET。
   * 幂等：(provider, eventId) 唯一，重复事件直接判重，不重复施加权益。
   */
  @Public()
  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>) {
    const secret = this.config.get<string>('BILLING_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      // fail-closed：未配置密钥时拒绝一切事件，而不是放行
      throw new UnauthorizedException({
        code: 'WEBHOOK_NOT_CONFIGURED',
        message: 'webhook 密钥未配置，拒绝事件',
      });
    }
    const dto = this.verifyWebhookSignature(req, secret);

    return this.prisma.withOrg(dto.organizationId, async (tx) => {
      const result = await this.ingest.ingest(tx, dto);
      if (result.duplicate) return { duplicate: true, eventId: dto.eventId };
      return { received: true, eventId: dto.eventId, applied: result.applied };
    });
  }

  /**
   * 平台运维：手动触发一轮订阅生命周期扫描（平台超管专用）。
   * 用于排障/演示，正常情况下由每分钟的定时任务自动执行。
   */
  @Post('lifecycle/run')
  @UseGuards(PlatformAdminGuard)
  runLifecycle() {
    return this.lifecycle.run();
  }

  /** 校验 webhook 签名并返回解析后的事件体；任何失败均 401，且不触碰数据库 */
  private verifyWebhookSignature(req: RawBodyRequest<Request>, secret: string): WebhookDto {
    const signature = req.headers['x-webhook-signature'];
    const sigStr = Array.isArray(signature) ? signature[0] : signature;
    if (!sigStr || !req.rawBody) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_SIGNATURE_MISSING',
        message: '缺少 webhook 签名或原始请求体',
      });
    }

    const fields = new Map(
      sigStr.split(',').map((kv) => kv.split('=') as [string, string]),
    );
    const t = fields.get('t');
    const v1 = fields.get('v1');
    if (!t || !v1) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: '签名格式无效，需要 t 与 v1',
      });
    }

    const ts = Number(t);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_TIMESTAMP_INVALID',
        message: '签名时间戳无效或超出 5 分钟有效窗口',
      });
    }

    const expected = createHmac('sha256', secret)
      .update(`${t}.`)
      .update(req.rawBody)
      .digest();
    const provided = Buffer.from(v1, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: '签名校验失败',
      });
    }

    // 签名已证明请求体来自持有密钥的一方，此时才信任 body 内容
    return req.body as WebhookDto;
  }
}
