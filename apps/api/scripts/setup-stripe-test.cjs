// node scripts/setup-stripe-test.cjs /absolute/test-key.env /absolute/output.env
// Only creates TeamSpace resources in Stripe TEST mode. Never prints credentials.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const Stripe = require('stripe');
async function main() {
  const input = path.resolve(process.argv[2] || '../../.test-runs/stripe-test.env');
  const output = path.resolve(process.argv[3] || input);
  const config = dotenv.parse(fs.readFileSync(input));
  const key = config.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_test_/.test(key)) throw new Error('A Stripe test secret is required; live keys are refused');
  const stripe = new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
  const map = {};
  const plans = [{ code: 'PRO', name: 'TeamSpace 专业版', monthly: 9900, yearly: 99900 }, { code: 'ENTERPRISE', name: 'TeamSpace 企业版', monthly: 299900, yearly: 2999900 }];
  for (const plan of plans) {
    const product = await stripe.products.create({ name: plan.name, metadata: { application: 'teamspace', planCode: plan.code } }, { idempotencyKey: `teamspace:test:product:${plan.code}:v1` });
    map[plan.code] = {};
    for (const interval of ['monthly','yearly']) {
      const price = await stripe.prices.create({ product: product.id, currency: 'cny', unit_amount: plan[interval], recurring: { interval: interval === 'monthly' ? 'month' : 'year' }, metadata: { application: 'teamspace', planCode: plan.code } }, { idempotencyKey: `teamspace:test:price:${plan.code}:${interval}:cny:${plan[interval]}` });
      map[plan.code][interval] = price.id;
    }
  }
  let secret = config.STRIPE_WEBHOOK_SECRET;
  let endpointId = config.STRIPE_WEBHOOK_ID;
  if (!secret) {
    const endpoint = await stripe.webhookEndpoints.create({ url: (config.PUBLIC_WEBHOOK_BASE_URL || 'https://api.purelamp.uk').replace(/\/$/, '') + '/api/v1/billing/stripe/webhook', enabled_events: ['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','checkout.session.completed'], metadata: { application: 'teamspace', environment: 'test' } }, { idempotencyKey: 'teamspace:test:webhook:api-purelamp:v1' });
    secret = endpoint.secret;
    endpointId = endpoint.id;
    if (!secret) throw new Error('Webhook secret missing; configure through Stripe dashboard');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  Object.assign(config, { STRIPE_SECRET_KEY:key, STRIPE_WEBHOOK_SECRET:secret, STRIPE_WEBHOOK_ID:endpointId, STRIPE_PRICE_MAP:JSON.stringify(map), BILLING_CURRENCY:'CNY', BILLING_MODE:'stripe' });
  fs.writeFileSync(output, Object.entries(config).map(([k,v]) => `${k}='${v}'`).join('\n') + '\n', {mode:0o600});
  console.log(JSON.stringify({ testMode: true, plans: Object.keys(map), webhookId: endpointId, savedTo: output }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
