import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { io } from 'socket.io-client';
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeBillingService } from '../src/modules/billing/stripe.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { CheckoutCoordinator } from '../src/modules/billing/checkout-coordinator.service';
import { PayPalBillingService } from '../src/modules/billing/paypal.service';

const base = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL } } });
const checks: { name: string; pass: boolean }[] = [];
async function main() {
  async function login(email: string) { const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) }); assert.equal(r.status, 201); return (await r.json()).accessToken; }
  const owner = await login('owner@acme.dev'), member = await login('member@acme.dev'), foreign = await login('owner@globex.dev');
  const org = await db.organization.findUniqueOrThrow({ where: { slug: 'acme' } });
  const memberRow = await db.membership.findFirstOrThrow({ where: { organizationId: org.id, user: { email: 'member@acme.dev' } } });
  const foreignRow = await db.membership.findFirstOrThrow({ where: { user: { email: 'owner@globex.dev' } } });
  const workspace = await db.workspace.findFirstOrThrow({ where: { organizationId: org.id } });
  async function call(path: string, token = owner, method = 'GET', body?: unknown) {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'x-organization-id': org.id, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  }
  function check(name: string, pass: boolean) { checks.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); }
  const suffix = Date.now();
  const group = await call('/groups', owner, 'POST', { name: `Delivery ${suffix}`, kind: 'CLIENT' }); assert.equal(group.status,201);
  const second = await call('/groups', owner, 'POST', { name: `Platform ${suffix}`, kind: 'TEAM' }); assert.equal(second.status,201);
  const g = group.body.id;
  check('cross-tenant membership rejected', (await call(`/groups/${g}/members`,owner,'POST',{ membershipId: foreignRow.id, role:'MEMBER' })).status === 400);
  check('non-manager cannot modify group', (await call(`/groups/${g}/members`,member,'POST',{ membershipId: memberRow.id, role:'MANAGER' })).status === 403);
  const created = await call('/projects',owner,'POST',{ name:`Restricted ${suffix}`, workspaceId:workspace.id }); assert.equal(created.status,201);
  const projectId = created.body.id;
  assert.equal((await call(`/groups/resources/projects/${projectId}`,owner,'PATCH',{ visibility:'RESTRICTED' })).status,200);
  check('restricted project hidden in list', !(await call('/projects',member)).body.some((p:any)=>p.id===projectId));
  check('restricted project detail denied', (await call(`/projects/${projectId}`,member)).status===404);
  check('restricted task list denied', (await call(`/tasks?projectId=${projectId}`,member)).status===404);
  check('foreign organization access denied', (await call('/groups',foreign)).status===403);
  await call(`/groups/${g}/members`,owner,'POST',{membershipId:memberRow.id,role:'MEMBER'});
  await call(`/groups/${second.body.id}/members`,owner,'POST',{membershipId:memberRow.id,role:'MEMBER'});
  const groups = await call('/groups'); check('member can belong to multiple flat units',groups.body.filter((x:any)=>x.members.some((m:any)=>m.membershipId===memberRow.id)).length>=2);
  assert.equal((await call(`/groups/${g}/grants`,owner,'POST',{projectId,access:'READ'})).status,201);
  check('READ grant exposes project', (await call(`/projects/${projectId}`,member)).status===200);
  check('READ grant does not allow editing', (await call(`/projects/${projectId}`,member,'PATCH',{name:'forbidden'})).status===404);
  const socket = io(base.replace('/api/v1',''),{ auth:{token:member}, transports:['websocket'], forceNew:true });
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  const open = await socket.emitWithAck('project:open',{organizationId:org.id,projectId}); check('authorized project socket opens',open.ok===true);
  await call(`/groups/${g}/grants/${projectId}`,owner,'DELETE');
  check('grant revoke denies next request', (await call(`/projects/${projectId}`,member)).status===404);
  const reopened = await socket.emitWithAck('project:open',{organizationId:org.id,projectId}); check('revoked project socket rejoin denied',reopened.ok===false);
  socket.disconnect();
  const stored = await db.groupMember.findFirstOrThrow({where:{groupId:g,role:'MANAGER'}});
  check('last unit manager protected', (await call(`/groups/${g}/members/${stored.membershipId}`,owner,'DELETE')).status===409);
  await call(`/groups/${g}/grants`,owner,'POST',{projectId,access:'READ'});
  await call(`/groups/${g}/archive`,owner,'POST');
  check('archived unit grants are inactive', (await call(`/projects/${projectId}`,member)).status===404);
  const app = new PrismaClient();
  try {
    const rows = await app.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_org_id', ${foreignRow.organizationId}, true)`;return tx.collaborationGroup.findMany({where:{id:g}});});
    check('RLS denies foreign group direct query',rows.length===0);
    const role:any[] = await app.$queryRaw`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    check('regression uses non-bypass application role',role[0].rolsuper===false && role[0].rolbypassrls===false);
  } finally {await app.$disconnect();}
  const audit = await db.operLog.count({where:{organizationId:org.id,resourceId:g}});check('group changes persist audit trail',audit>=4);
  // Real PostgreSQL transactions/RLS with a simulated provider adapter; no external payment is made.
  const billingPrisma = new PrismaService();
  const config = new ConfigService({STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',STRIPE_PRICE_MAP:JSON.stringify({PRO:{monthly:'price_foundation'}})});
  const billing = new StripeBillingService(config,billingPrisma,new AuditService(billingPrisma));
  let providerStatus='active';
  billing.client=(()=>({subscriptions:{list:async()=>({has_more:false,data:[{id:`sub_foundation_${suffix}`,created:Math.floor(Date.now()/1000),status:providerStatus,cancel_at_period_end:false,items:{data:[{price:{id:'price_foundation'},current_period_start:1700000000,current_period_end:1900000000}]}}]})}})) as any;
  const customer=`cus_foundation_${suffix}`;
  await db.organization.update({where:{id:org.id},data:{stripeCustomerId:customer}});
  const event=(id:string)=>({id,type:'customer.subscription.updated',livemode:false,data:{object:{customer,status:'stale-payload'}}}) as any;
  try {
    const coordinator = new CheckoutCoordinator(billingPrisma);
    const intentOrg = await db.organization.create({data:{name:'Checkout concurrency fixture',slug:`checkout-fixture-${suffix}`}});
    const intents = await Promise.all([coordinator.reserve(intentOrg.id,'stripe','PRO:monthly'),coordinator.reserve(intentOrg.id,'stripe','PRO:monthly')]);
    check('concurrent checkout retries reuse persisted intent',intents[0].checkoutAttemptId===intents[1].checkoutAttemptId);
    let conflict=false;try{await coordinator.reserve(intentOrg.id,'paypal','PRO:monthly');}catch(e:any){conflict=e.getStatus?.()===409;}
    check('unknown Stripe result blocks duplicate PayPal checkout',conflict);
    const deliveries=await Promise.all([billing.handle(event(`evt_foundation_${suffix}`)),billing.handle(event(`evt_foundation_${suffix}`))]);
    check('concurrent Stripe deliveries commit once',deliveries.filter((x:any)=>x.duplicate).length===1 && await db.billingEvent.count({where:{eventId:`evt_foundation_${suffix}`}})===1);
    const pro=await db.plan.findUniqueOrThrow({where:{code:'PRO'}});
    check('Stripe active atomically grants mapped entitlement',(await db.entitlement.findUniqueOrThrow({where:{organizationId:org.id}})).planId===pro.id);
    providerStatus='past_due';await billing.handle(event(`evt_due_${suffix}`));
    const free=await db.plan.findUniqueOrThrow({where:{code:'FREE'}});
    check('Stripe past due revokes paid entitlement',(await db.entitlement.findUniqueOrThrow({where:{organizationId:org.id}})).planId===free.id);
    providerStatus='active';await billing.handle(event(`evt_restore_${suffix}`));
    check('reconciliation recovers paid entitlement',(await db.entitlement.findUniqueOrThrow({where:{organizationId:org.id}})).planId===pro.id);
    providerStatus='canceled';await billing.handle(event(`evt_cancel_${suffix}`));
    const paypalConfig=new ConfigService({PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture',PAYPAL_WEBHOOK_ID:'WH-fixture',PAYPAL_PLAN_MAP:JSON.stringify({PRO:{monthly:'P-fixture'}})});
    const paypal=new PayPalBillingService(paypalConfig,billingPrisma,new AuditService(billingPrisma),coordinator);
    let paypalStatus='ACTIVE';
    const paypalId=`I-fixture-${suffix}`;
    paypal.request=(async()=>({id:paypalId,plan_id:'P-fixture',status:paypalStatus,create_time:'2026-01-01T00:00:00Z',billing_info:{last_payment:{amount:{value:'99.00',currency_code:'USD'},time:'2026-01-01T00:00:00Z'},next_billing_time:'2030-01-01T00:00:00Z',outstanding_balance:{value:'0'}}})) as any;
    await db.organization.update({where:{id:org.id},data:{paypalSubscriptionId:paypalId}});
    const paypalEvent={id:`WH-fixture-${suffix}`,event_type:'BILLING.SUBSCRIPTION.ACTIVATED',resource:{id:paypalId}};
    const deliveriesPayPal=await Promise.all([paypal.handle(paypalEvent),paypal.handle(paypalEvent)]);
    check('concurrent PayPal delivery commits once',deliveriesPayPal.filter((x:any)=>x.duplicate).length===1);
    check('PayPal paid subscription grants local entitlement',(await db.entitlement.findUniqueOrThrow({where:{organizationId:org.id}})).planId===pro.id);
    paypalStatus='CANCELLED';await paypal.handle({...paypalEvent,id:`WH-cancel-${suffix}`});
    check('PayPal cancellation revokes local entitlement',(await db.entitlement.findUniqueOrThrow({where:{organizationId:org.id}})).planId===free.id);
  } finally {await billingPrisma.$disconnect();}
  const dir=process.env.EVIDENCE_DIR??resolve(__dirname,'../../../evidence');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'acceptance-foundation.json'),JSON.stringify({environment:base,at:new Date().toISOString(),checks},null,2));
  assert(checks.every(c=>c.pass),'foundation acceptance failed');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
