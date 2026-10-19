import { CheckoutCoordinator } from './checkout-coordinator.service';
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, BusinessType } from '../audit/audit.service';

@Injectable()
export class StripeBillingService {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly checkouts: CheckoutCoordinator = new CheckoutCoordinator(prisma)) {}

  configuration() {
    const key = this.config.get<string>('STRIPE_SECRET_KEY', '');
    return { enabled: !!(key && this.config.get('STRIPE_WEBHOOK_SECRET')), currency: this.config.get('BILLING_CURRENCY', 'CNY'), mode: key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test', sandboxEnabled: this.config.get('BILLING_MODE', process.env.NODE_ENV === 'production' ? 'stripe' : 'sandbox') === 'sandbox' };
  }
  client() {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) throw new ServiceUnavailableException({ code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe 尚未配置' });
    return new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
  }
  webUrl() { return this.config.get<string>('WEB_URL', 'http://localhost:3000').replace(/\/$/, ''); }
  prices(): Record<string, { monthly?: string; yearly?: string }> {
    try { return JSON.parse((this.config.get<string>('STRIPE_PRICE_MAP') || '{}')); }
    catch { throw new ServiceUnavailableException('STRIPE_PRICE_MAP 配置无效'); }
  }

  async checkout(orgId: string, planCode: string, interval: 'monthly' | 'yearly') {
    if (!this.configuration().enabled) throw new ServiceUnavailableException('Stripe 收款与 Webhook 配置未就绪');
    const price = this.prices()[planCode]?.[interval];
    if (!price) throw new BadRequestException({ code: 'STRIPE_PRICE_UNAVAILABLE', message: '该套餐尚未配置 Stripe 价格' });
    const stripe = this.client();
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || plan.status !== 'NORMAL') throw new BadRequestException('套餐不可用');
    const configuredPrice = await stripe.prices.retrieve(price);
    const amount = Math.round(Number(interval === 'yearly' ? plan.priceYearly : plan.priceMonthly) * 100);
    if (!configuredPrice.active || configuredPrice.unit_amount !== amount || configuredPrice.currency !== this.configuration().currency.toLowerCase() || configuredPrice.recurring?.interval !== (interval === 'yearly' ? 'year' : 'month')) throw new BadRequestException({code:'STRIPE_PRICE_MISMATCH',message:'Stripe 价格、币种或周期与本地套餐不一致'});
    const org = await this.checkouts.reserve(orgId, 'stripe', `${planCode}:${interval}`);
    if (org.checkoutUrl) return {url:org.checkoutUrl,sessionId:org.checkoutSessionId};
    const customerId = org.stripeCustomerId ?? (await stripe.customers.create({name:org.name,metadata:{organizationId:orgId}},{idempotencyKey:`teamspace:customer:${orgId}`})).id;
    await this.prisma.withOrg(orgId,tx=>tx.organization.update({where:{id:orgId},data:{stripeCustomerId:customerId}}));
    const session = await stripe.checkout.sessions.create({customer:customerId,mode:'subscription',line_items:[{price,quantity:1}],client_reference_id:orgId,metadata:{organizationId:orgId},subscription_data:{metadata:{organizationId:orgId}},success_url:this.webUrl()+'/billing?checkout=returned',cancel_url:this.webUrl()+'/billing?checkout=canceled'}, {idempotencyKey:`teamspace:checkout:${org.checkoutAttemptId}`});
    if (!session.url) throw new ServiceUnavailableException('Stripe 未返回收银台地址');
    await this.prisma.withOrg(orgId,tx=>tx.organization.update({where:{id:orgId},data:{checkoutSessionId:session.id,checkoutUrl:session.url,checkoutExpiresAt:new Date(session.expires_at*1000)}}));
    return {url:session.url,sessionId:session.id};
  }

  async handle(event: Stripe.Event) {
    if (event.livemode !== (this.configuration().mode === 'live')) throw new BadRequestException('Stripe 环境不匹配');
    const supported = ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed', 'checkout.session.completed'];
    if (!supported.includes(event.type)) return { received: true, ignored: true };
    const obj = event.data.object as unknown as { customer?: string | { id: string } };
    const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
    if (!customerId) return { received: true, ignored: true };
    const org = await this.prisma.withBillingMaintenance(tx => tx.organization.findUnique({ where: { stripeCustomerId: customerId } }));
    if (!org) throw new BadRequestException({ code: 'STRIPE_CUSTOMER_UNMAPPED', message: '客户尚未映射组织，请稍后重试' });
    return this.sync(org.id, customerId, event);
  }

  async reconcile(orgId: string) {
    const org = await this.prisma.withOrg(orgId, tx => tx.organization.findUniqueOrThrow({ where: { id: orgId } }));
    if (!org.stripeCustomerId) throw new BadRequestException('组织尚未关联 Stripe');
    return this.sync(orgId, org.stripeCustomerId);
  }

  private async sync(orgId: string, customerId: string, event?: Stripe.Event) {
    return this.prisma.withOrg(orgId, async tx => {
      // Serialize reconciliation and retrieve CURRENT provider state; event payload ordering is not authoritative.
      await tx.$executeRaw`SELECT id FROM org_organization WHERE id = ${orgId} FOR UPDATE`;
      if (event && await tx.billingEvent.findUnique({ where: { provider_eventId: { provider: 'stripe', eventId: event.id } } })) return { duplicate: true };
      const subscriptions = await this.client().subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      if (subscriptions.has_more) throw new ConflictException('订阅过多，需人工核对');
      const candidates = subscriptions.data.filter(s => ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(s.status));
      if (candidates.length > 1) throw new ConflictException({ code: 'MULTIPLE_SUBSCRIPTIONS', message: '发现多个订阅，需人工核对' });
      const current = candidates[0] ?? subscriptions.data.sort((a,b) => b.created-a.created)[0];
      let plan = await tx.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
      let status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' = 'CANCELED';
      if (current) {
        const priceId = current.items.data[0]?.price.id;
        const code = Object.entries(this.prices()).find(([, values]) => Object.values(values).includes(priceId))?.[0];
        const paidAccess = current.status === 'active' || current.status === 'trialing';
        if ((paidAccess || current.status === 'past_due') && !code) throw new BadRequestException('Stripe 价格没有本地套餐映射');
        status = paidAccess ? 'ACTIVE' : current.status === 'past_due' ? 'PAST_DUE' : 'CANCELED';
        if (paidAccess) plan = await tx.plan.findUniqueOrThrow({ where: { code: code! } });
        const item = current.items.data[0];
        const data = { organizationId: orgId, planId: code ? (await tx.plan.findUniqueOrThrow({ where: { code } })).id : plan.id, provider: 'stripe', status, seats: 1, cancelAtPeriodEnd: current.cancel_at_period_end, currentPeriodStart: new Date(item.current_period_start * 1000), currentPeriodEnd: new Date(item.current_period_end * 1000) };
        await tx.subscription.updateMany({ where: { organizationId: orgId, provider: 'stripe', externalId: { not: current.id }, status: { in: ['ACTIVE','PAST_DUE'] } }, data: { status: 'CANCELED' } });
        // SQL NULL does not match `not`; sandbox records are canceled separately.
        await tx.subscription.updateMany({ where: { organizationId: orgId, provider: 'sandbox', status: { in: ['ACTIVE','PAST_DUE'] } }, data: { status: 'CANCELED' } });
        await tx.subscription.upsert({ where: { externalId: current.id }, create: { ...data, externalId: current.id }, update: data });
      }
      const other = await tx.subscription.findFirst({where:{organizationId:orgId,provider:'paypal',status:{in:['ACTIVE','PAST_DUE']}}});
      if (other) {
        if (status === 'ACTIVE') throw new ConflictException('PayPal 已存在有效订阅，需人工核对跨渠道订阅');
        if (event) await tx.billingEvent.create({data:{organizationId:orgId,provider:'stripe',eventId:event.id,type:event.type,payload:{ignored:'other-provider-active'},processed:true}});
        return {received:true,ignored:true};
      }
      const before = await tx.entitlement.findUnique({ where: { organizationId: orgId } });
      const entitlement = { planId: plan.id, seatsIncluded: plan.seatsIncluded, aiCreditsTotal: plan.aiCredits, maxProjects: plan.maxProjects, storageGb: plan.storageGb, features: plan.features as Prisma.InputJsonValue };
      await tx.entitlement.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...entitlement }, update: entitlement });
      await tx.organization.update({ where: { id: orgId }, data: { planId: plan.id, ...(current && status === 'ACTIVE' ? {checkoutAttemptId:null,checkoutProvider:null,checkoutUrl:null,checkoutExpiresAt:null}: {}) } });
      if (event) await tx.billingEvent.create({ data: { organizationId: orgId, provider: 'stripe', eventId: event.id, type: event.type, payload: { subscriptionId: current?.id ?? null, status, planCode: plan.code }, processed: true } });
      await this.audit.record(tx, { organizationId: orgId, actorId: null, title: 'Stripe 订阅对账', businessType: BusinessType.UPDATE, action: 'billing:stripe_sync', resourceType: 'Subscription', resourceId: current?.id, before, after: { status, planCode: plan.code }, traceId: event?.id ?? 'billing:reconcile' });
      return { received: true, status, planCode: plan.code };
    });
  }
}
