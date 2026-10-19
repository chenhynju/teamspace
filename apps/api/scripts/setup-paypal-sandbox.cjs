// node scripts/setup-paypal-sandbox.cjs /absolute/payments-sandbox.env
const fs=require('node:fs');const path=require('node:path');const dotenv=require('dotenv');
async function main(){
  const file=path.resolve(process.argv[2]||'../../.test-runs/payments-sandbox.env');const config=dotenv.parse(fs.readFileSync(file));
  if(config.PAYPAL_ENV!=='sandbox'||!config.PAYPAL_CLIENT_ID||!config.PAYPAL_CLIENT_SECRET)throw new Error('Sandbox client ID/secret required; live environment refused');
  const base='https://api-m.sandbox.paypal.com';
  const auth=await fetch(base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(config.PAYPAL_CLIENT_ID+':'+config.PAYPAL_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(10000)});
  if(!auth.ok)throw new Error('Sandbox OAuth failed: '+auth.status);const token=(await auth.json()).access_token;
  async function request(url,body,id){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(id?{'PayPal-Request-Id':id}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('PayPal setup failed: '+r.status);return r.json();}
  const map=config.PAYPAL_PLAN_MAP?JSON.parse(config.PAYPAL_PLAN_MAP):{};
  for(const plan of [{code:'PRO',monthly:'99.00',yearly:'999.00'},{code:'ENTERPRISE',monthly:'2999.00',yearly:'29999.00'}]){
    const productId='TEAMSPACE-TEST-'+plan.code;
    const product=await request('/v1/catalogs/products',{id:productId,name:'TeamSpace '+plan.code,type:'SERVICE',category:'SOFTWARE'},'ts-product-'+plan.code.toLowerCase()).catch(async error=>{try{return await request('/v1/catalogs/products/'+productId);}catch{throw error;}});
    map[plan.code]=map[plan.code]||{};
    for(const interval of ['monthly','yearly']){
      if(map[plan.code][interval])continue;
      const remote=await request('/v1/billing/plans',{product_id:product.id,name:`TeamSpace ${plan.code} ${interval} USD`,status:'ACTIVE',billing_cycles:[{frequency:{interval_unit:interval==='monthly'?'MONTH':'YEAR',interval_count:1},tenure_type:'REGULAR',sequence:1,total_cycles:0,pricing_scheme:{fixed_price:{value:plan[interval],currency_code:'USD'}}}],payment_preferences:{auto_bill_outstanding:true,setup_fee_failure_action:'CANCEL',payment_failure_threshold:1}},`ts-${plan.code.toLowerCase()}-${interval}-usd-v1`);
      map[plan.code][interval]=remote.id;
    }
  }
  if(!config.PAYPAL_WEBHOOK_ID){
    const webhook=await request('/v1/notifications/webhooks',{url:(config.PUBLIC_WEBHOOK_BASE_URL||'https://api.purelamp.uk').replace(/\/$/,'')+'/api/v1/billing/paypal/webhook',event_types:['BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.UPDATED','BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.SUSPENDED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.PAYMENT.FAILED','PAYMENT.SALE.COMPLETED'].map(name=>({name}))},'ts-sandbox-webhook-v1');config.PAYPAL_WEBHOOK_ID=webhook.id;
  }
  config.PAYPAL_PLAN_MAP=JSON.stringify(map);config.PAYPAL_CURRENCY='USD';
  fs.writeFileSync(file,Object.entries(config).map(([k,v])=>`${k}='${v}'`).join('\n')+'\n',{mode:0o600});
  console.log(JSON.stringify({sandbox:true,plans:Object.keys(map),webhookId:config.PAYPAL_WEBHOOK_ID,savedTo:file}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
