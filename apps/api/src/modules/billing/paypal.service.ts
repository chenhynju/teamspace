import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CheckoutCoordinator } from './checkout-coordinator.service';

@Injectable()
export class PayPalBillingService {
  private token?: { value: string; until: number };
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly checkouts: CheckoutCoordinator) {}
  configuration() { return {enabled:!!(this.config.get('PAYPAL_CLIENT_ID')&&this.config.get('PAYPAL_CLIENT_SECRET')&&this.config.get('PAYPAL_WEBHOOK_ID')),mode:this.config.get('PAYPAL_ENV','sandbox'),currency:this.config.get('PAYPAL_CURRENCY','USD')}; }
  base() { return this.config.get('PAYPAL_ENV')==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com'; }
  map(): Record<string,{monthly?:string;yearly?:string}> { try{return JSON.parse(this.config.get('PAYPAL_PLAN_MAP')||'{}');}catch{throw new ServiceUnavailableException('PAYPAL_PLAN_MAP 无效');} }
  async request(path:string, method='GET', body?:unknown, requestId?:string):Promise<any> {
    if (!this.token || this.token.until<Date.now()) {
      const clientId=this.config.get<string>('PAYPAL_CLIENT_ID'),secret=this.config.get<string>('PAYPAL_CLIENT_SECRET');
      if (!clientId||!secret) throw new ServiceUnavailableException('PayPal 未配置');
      const r=await fetch(this.base()+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${clientId}:${secret}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw new ServiceUnavailableException('PayPal 授权失败');
      const data=await r.json();this.token={value:data.access_token,until:Date.now()+Math.max(1,data.expires_in-60)*1000};
    }
    const r=await fetch(this.base()+path,{method,headers:{Authorization:`Bearer ${this.token.value}`,'Content-Type':'application/json',...(requestId?{'PayPal-Request-Id':requestId}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new ServiceUnavailableException({code:'PAYPAL_REQUEST_FAILED',message:`PayPal 请求失败（${r.status}），请稍后重试`});
    return r.status===204?{}:r.json();
  }
  async checkout(orgId:string,code:string,interval:'monthly'|'yearly') {
    if(!this.configuration().enabled)throw new ServiceUnavailableException('PayPal 与 Webhook 配置未就绪');
    const planId=this.map()[code]?.[interval];if(!planId)throw new BadRequestException('该套餐未配置 PayPal 价格');
    const plan=await this.prisma.plan.findUnique({where:{code}});if(!plan||plan.status!=='NORMAL')throw new BadRequestException('套餐不可用');
    const remote=await this.request(`/v1/billing/plans/${encodeURIComponent(planId)}`);
    const cycle=remote.billing_cycles?.find((c:any)=>c.tenure_type==='REGULAR');
    if(remote.status!=='ACTIVE'||!cycle||cycle.frequency.interval_unit!==(interval==='yearly'?'YEAR':'MONTH')||cycle.frequency.interval_count!==1||Number(cycle.pricing_scheme.fixed_price.value)!==Number(interval==='yearly'?plan.priceYearly:plan.priceMonthly)||cycle.pricing_scheme.fixed_price.currency_code!==this.configuration().currency)throw new BadRequestException('PayPal 价格、币种或周期与本地套餐不一致');
    const org=await this.checkouts.reserve(orgId,'paypal',`${code}:${interval}`);
    if(org.checkoutUrl)return{url:org.checkoutUrl,subscriptionId:org.checkoutSessionId};
    const web=this.config.get('WEB_URL','http://localhost:3000').replace(/\/$/,'');
    const subscription=await this.request('/v1/billing/subscriptions','POST',{plan_id:planId,custom_id:orgId,application_context:{brand_name:'TeamSpace',user_action:'SUBSCRIBE_NOW',return_url:web+'/billing?paypal=returned',cancel_url:web+'/billing?paypal=canceled'}},org.checkoutAttemptId!);
    const url=subscription.links?.find((l:any)=>l.rel==='approve')?.href;if(!url)throw new ServiceUnavailableException('PayPal 未返回授权地址');
    await this.prisma.withOrg(orgId,tx=>tx.organization.update({where:{id:orgId},data:{paypalSubscriptionId:subscription.id,checkoutSessionId:subscription.id,checkoutUrl:url}}));
    return{url,subscriptionId:subscription.id};
  }
  async verify(headers:Record<string,unknown>,event:any) {
    const id=this.config.get('PAYPAL_WEBHOOK_ID');if(!id)throw new ServiceUnavailableException('PayPal Webhook 未配置');
    const fields=['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time'];
    if(fields.some(f=>typeof headers[f]!=='string'))throw new UnauthorizedException('PayPal 签名信息缺失');
    const result=await this.request('/v1/notifications/verify-webhook-signature','POST',{auth_algo:headers[fields[0]],cert_url:headers[fields[1]],transmission_id:headers[fields[2]],transmission_sig:headers[fields[3]],transmission_time:headers[fields[4]],webhook_id:id,webhook_event:event});
    if(result.verification_status!=='SUCCESS')throw new UnauthorizedException('PayPal 签名无效');
  }
  async handle(event:any) {
    if(typeof event?.id!=='string'||typeof event?.event_type!=='string')throw new BadRequestException('PayPal 事件无效');
    const supported=['BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.UPDATED','BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.SUSPENDED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.PAYMENT.FAILED','PAYMENT.SALE.COMPLETED'];
    if(!supported.includes(event.event_type))return{received:true,ignored:true};
    const externalId=event.event_type.startsWith('BILLING.SUBSCRIPTION.')?event.resource?.id:event.resource?.billing_agreement_id;
    if(typeof externalId!=='string')throw new BadRequestException('PayPal 订阅编号缺失');
    const org=await this.prisma.withBillingMaintenance(tx=>tx.organization.findUnique({where:{paypalSubscriptionId:externalId}}));
    if(!org)throw new BadRequestException('PayPal 订阅尚未映射，请稍后重试');
    return this.sync(org.id,externalId,event);
  }
  async reconcile(orgId:string) {
    const org=await this.prisma.withOrg(orgId,tx=>tx.organization.findUniqueOrThrow({where:{id:orgId}}));
    if(!org.paypalSubscriptionId)throw new BadRequestException('没有 PayPal 订阅');return this.sync(orgId,org.paypalSubscriptionId);
  }
  async cancel(orgId:string) {
    const org=await this.prisma.withOrg(orgId,tx=>tx.organization.findUniqueOrThrow({where:{id:orgId}}));
    if(!org.paypalSubscriptionId)throw new BadRequestException('没有 PayPal 订阅');
    const current=await this.request(`/v1/billing/subscriptions/${encodeURIComponent(org.paypalSubscriptionId)}`);
    if(!['CANCELLED','EXPIRED'].includes(current.status))await this.request(`/v1/billing/subscriptions/${encodeURIComponent(org.paypalSubscriptionId)}/cancel`,'POST',{reason:'Organization administrator requested cancellation'});
    return this.sync(orgId,org.paypalSubscriptionId);
  }
  private async sync(orgId:string,id:string,event?:any) {
    return this.prisma.withOrg(orgId,async tx=>{
      await tx.$executeRaw`SELECT id FROM org_organization WHERE id = ${orgId} FOR UPDATE`;
      if(event&&await tx.billingEvent.findUnique({where:{provider_eventId:{provider:'paypal',eventId:event.id}}}))return{duplicate:true};
      const remote=await this.request(`/v1/billing/subscriptions/${encodeURIComponent(id)}`);
      const code=Object.entries(this.map()).find(([,v])=>Object.values(v).includes(remote.plan_id))?.[0];
      if(!code)throw new BadRequestException('PayPal 订阅套餐未映射');
      const paid=remote.status==='ACTIVE'&&Number(remote.billing_info?.last_payment?.amount?.value)>0&&Number(remote.billing_info?.outstanding_balance?.value??0)===0;
      const status=paid?'ACTIVE':remote.status==='ACTIVE'||remote.status==='SUSPENDED'?'PAST_DUE':'CANCELED';
      const other=await tx.subscription.findFirst({where:{organizationId:orgId,provider:'stripe',status:{in:['ACTIVE','PAST_DUE']}}});
      if(other&&paid)throw new ConflictException('Stripe 已有订阅，需人工核对跨渠道订阅');
      if(!other){
        const plan=await tx.plan.findUniqueOrThrow({where:{code:paid?code:'FREE'}});
        const old=await tx.entitlement.findUnique({where:{organizationId:orgId}});
        const e={planId:plan.id,seatsIncluded:plan.seatsIncluded,aiCreditsTotal:plan.aiCredits,maxProjects:plan.maxProjects,storageGb:plan.storageGb,features:plan.features as Prisma.InputJsonValue};
        await tx.entitlement.upsert({where:{organizationId:orgId},create:{organizationId:orgId,...e},update:e});
        await tx.organization.update({where:{id:orgId},data:{planId:plan.id,...(paid||['CANCELLED','EXPIRED'].includes(remote.status)?{checkoutAttemptId:null,checkoutProvider:null,checkoutUrl:null,checkoutExpiresAt:null}:{})}});
        const localPlan=await tx.plan.findUniqueOrThrow({where:{code}});
        const start=new Date(remote.billing_info?.last_payment?.time??remote.start_time??remote.create_time);
        const end=new Date(remote.billing_info?.next_billing_time??start);
        if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime()))throw new BadRequestException('PayPal 账期无效');
        const data={organizationId:orgId,planId:localPlan.id,provider:'paypal',status:status as 'ACTIVE'|'PAST_DUE'|'CANCELED',currentPeriodStart:start,currentPeriodEnd:end,seats:1};
        await tx.subscription.updateMany({where:{organizationId:orgId,provider:'sandbox',status:{in:['ACTIVE','PAST_DUE']}},data:{status:'CANCELED'}});
        await tx.subscription.upsert({where:{externalId:id},create:{...data,externalId:id},update:data});
        await this.audit.record(tx,{organizationId:orgId,actorId:null,title:'PayPal 订阅对账',action:'billing:paypal_sync',resourceType:'Subscription',resourceId:id,before:old,after:{status,planCode:plan.code},traceId:event?.id??'paypal:reconcile'});
      }
      if(event)await tx.billingEvent.create({data:{organizationId:orgId,provider:'paypal',eventId:event.id,type:event.event_type,payload:{subscriptionId:id,status},processed:true}});
      return{received:true,status,planCode:paid?code:'FREE',ignored:!!other};
    });
  }
}
