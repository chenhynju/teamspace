const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const { StripeBillingService } = require('../dist/modules/billing/stripe.service');
const { StripeController } = require('../dist/modules/billing/stripe.controller');

function fixture() {
  let grants = 0;
  const events = new Set();
  let state = { id: 'sub_1', created: 1, status: 'active', cancel_at_period_end: false, items: { data: [{ price: { id: 'price_pro' }, current_period_start: 1700000000, current_period_end: 1702592000 }] } };
  const plans = { FREE: { id: 'free', code: 'FREE', seatsIncluded: 2, aiCredits: 0, maxProjects: 1, storageGb: 1, features: {} }, PRO: { id: 'pro', code: 'PRO', seatsIncluded: 10, aiCredits: 100, maxProjects: 20, storageGb: 10, features: {} } };
  const tx = {
    $executeRaw: async () => {},
    organization: { findUnique: async () => ({ id: 'org_1', stripeCustomerId: 'cus_1' }), update: async () => {} },
    billingEvent: { findUnique: async ({ where }) => events.has(where.provider_eventId.eventId) ? {} : null, create: async ({ data }) => events.add(data.eventId) },
    subscription: { updateMany: async () => {}, upsert: async () => {} },
    plan: { findUniqueOrThrow: async ({ where }) => plans[where.code] },
    entitlement: { findUnique: async () => null, upsert: async ({ update }) => { grants++; tx.lastPlan = update.planId; } },
  };
  const config = new ConfigService({ STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_MAP: JSON.stringify({ PRO: { monthly: 'price_pro' } }) });
  const prisma = { withOrg: async (_, fn) => fn(tx), withBillingMaintenance: async fn => fn(tx) };
  const service = new StripeBillingService(config, prisma, { record: async () => {} });
  service.client = () => ({ subscriptions: { list: async () => ({ data: state ? [state] : [], has_more: false }) } });
  const event = (id, status = 'old-payload-ignored') => ({ id, type: 'customer.subscription.updated', livemode: false, data: { object: { customer: 'cus_1', status } } });
  return { service, config, prisma, tx, event, setState: value => { state = value; }, state: () => state, grants: () => grants };
}

test('duplicate delivery does not grant twice', async () => { const f = fixture(); await f.service.handle(f.event('evt_1')); assert.deepEqual(await f.service.handle(f.event('evt_1')), { duplicate: true }); assert.equal(f.grants(), 1); });
test('old cancellation payload cannot override current active Stripe state', async () => { const f = fixture(); await f.service.handle(f.event('evt_old','canceled')); assert.equal(f.tx.lastPlan, 'pro'); });
test('past due revokes paid entitlement; recovery restores it', async () => { const f = fixture(); const active = f.state(); f.setState({ ...active, status: 'past_due' }); await f.service.handle(f.event('evt_due')); assert.equal(f.tx.lastPlan, 'free'); f.setState(active); await f.service.handle(f.event('evt_recovered')); assert.equal(f.tx.lastPlan, 'pro'); });
test('canceled subscriptions return to FREE', async () => { const f = fixture(); f.setState({ ...f.state(), status: 'canceled' }); await f.service.handle(f.event('evt_cancel')); assert.equal(f.tx.lastPlan, 'free'); });
test('unknown price fails without granting rights', async () => { const f = fixture(); const state = f.state(); state.items.data[0].price.id = 'price_foreign'; await assert.rejects(f.service.handle(f.event('evt_foreign'))); assert.equal(f.grants(), 0); });
test('provider outage is retryable and event is not marked processed', async () => { const f = fixture(); f.service.client = () => ({ subscriptions: { list: async () => { throw new Error('provider unavailable'); } } }); await assert.rejects(f.service.handle(f.event('evt_outage'))); assert.equal(f.grants(), 0); assert.equal(await f.tx.billingEvent.findUnique({ where: { provider_eventId: { eventId: 'evt_outage' } } }), null); });
test('live events cannot enter test billing', async () => { const f = fixture(); await assert.rejects(f.service.handle({ ...f.event('evt_live'), livemode: true })); });
test('official SDK rejects invalid webhook signature before DB access', async () => { const f = fixture(); f.service.client = StripeBillingService.prototype.client.bind(f.service); const controller = new StripeController(f.config, f.prisma, f.service); await assert.rejects(controller.webhook({ headers: { 'stripe-signature': 't=1,v1=bad' }, rawBody: Buffer.from('{}') }), e => e.getStatus() === 401); assert.equal(f.grants(), 0); });
test('missing price mapping cannot open checkout', async () => { const f = fixture(); await assert.rejects(f.service.checkout('org_1','FOREIGN','monthly'), e => e.getStatus() === 400); });
