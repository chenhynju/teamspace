const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ConfigService} = require('@nestjs/config');
const {PayPalBillingService} = require('../dist/modules/billing/paypal.service');
function fixture(){
  const seen=new Set();let planId;let remoteStatus='ACTIVE';let paid=true;
  const tx={$executeRaw:async()=>{},organization:{findUnique:async()=>({id:'org',paypalSubscriptionId:'I-TEST'}),update:async()=>{}},billingEvent:{findUnique:async({where})=>seen.has(where.provider_eventId.eventId)?{}:null,create:async({data})=>seen.add(data.eventId)},subscription:{findFirst:async()=>null,updateMany:async()=>{},upsert:async()=>{}},plan:{findUniqueOrThrow:async({where})=>({id:where.code,code:where.code,seatsIncluded:5,aiCredits:100,maxProjects:3,storageGb:1,features:{}})},entitlement:{findUnique:async()=>null,upsert:async({update})=>{planId=update.planId;}}};
  const config=new ConfigService({PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'test',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_WEBHOOK_ID:'WH-TEST',PAYPAL_PLAN_MAP:JSON.stringify({PRO:{monthly:'P-TEST'}})});
  const service=new PayPalBillingService(config,{withOrg:async(_,fn)=>fn(tx),withBillingMaintenance:async fn=>fn(tx)},{record:async()=>{}},{});
  service.request=async(path)=>path.includes('verify-webhook')?{verification_status:'FAILURE'}:{id:'I-TEST',plan_id:'P-TEST',status:remoteStatus,create_time:'2026-01-01T00:00:00Z',billing_info:{last_payment:paid?{amount:{value:'99',currency_code:'USD'},time:'2026-01-01T00:00:00Z'}:undefined,next_billing_time:'2030-01-01T00:00:00Z',outstanding_balance:{value:'0'}}};
  const event=id=>({id,event_type:'BILLING.SUBSCRIPTION.ACTIVATED',resource:{id:'I-TEST'}});
  return{service,tx,event,setStatus:s=>{remoteStatus=s;},setPaid:p=>{paid=p;},plan:()=>planId};
}
test('PayPal active with verified paid state grants plan; duplicate ignored',async()=>{const f=fixture();await f.service.handle(f.event('WH-1'));assert.equal(f.plan(),'PRO');assert.deepEqual(await f.service.handle(f.event('WH-1')),{duplicate:true});});
test('PayPal approval without payment cannot grant paid rights',async()=>{const f=fixture();f.setPaid(false);await f.service.handle(f.event('WH-1'));assert.equal(f.plan(),'FREE');});
test('PayPal cancellation revokes and recovery restores rights',async()=>{const f=fixture();f.setStatus('CANCELLED');await f.service.handle(f.event('WH-1'));assert.equal(f.plan(),'FREE');f.setStatus('ACTIVE');await f.service.handle(f.event('WH-2'));assert.equal(f.plan(),'PRO');});
test('PayPal stale payload follows current provider state',async()=>{const f=fixture();await f.service.handle({...f.event('WH-1'),resource:{id:'I-TEST',status:'CANCELLED'}});assert.equal(f.plan(),'PRO');});
test('PayPal requires transmission headers',async()=>{const f=fixture();await assert.rejects(f.service.verify({},f.event('WH-1')),e=>e.getStatus()===401);});
test('PayPal rejects failed official verification',async()=>{const f=fixture();const headers=Object.fromEntries(['auth-algo','cert-url','transmission-id','transmission-sig','transmission-time'].map(x=>['paypal-'+x,'test']));await assert.rejects(f.service.verify(headers,f.event('WH-1')),e=>e.getStatus()===401);});
test('PayPal defaults to sandbox endpoint',()=>{const f=fixture();assert.equal(f.service.base(),'https://api-m.sandbox.paypal.com');});
