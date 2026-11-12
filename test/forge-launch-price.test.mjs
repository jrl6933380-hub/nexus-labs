import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPricing, setPricing, validatePricing, offerFromPricing } from '../lib/forgeLaunchPrice.js';
import { createForgePricingHandler } from '../api/forge-launch-price.js';
import { checkoutLineItems } from '../lib/forgeStripe.js';
import { generatePitchScript } from '../lib/forgePitch.js';

const store = () => { const m = new Map(); return async c => { if (c[0] === 'GET') return m.get(c[1]) ?? null; if (c[0] === 'SET') { m.set(c[1], c[2]); return 'OK'; } }; };
const res = () => { const r = { setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const post = body => ({ method: 'POST', headers: { origin: 'https://x.test', host: 'x.test' }, body });

test('default is $50 today then $25/mo; store errors fall back to default', async () => {
  const p = await getPricing({ redis: async () => { throw new Error('down'); } });
  assert.equal(p.firstChargeCents, 5000); assert.equal(p.monthlyCents, 2500); assert.equal(p.activationCents, 2500);
});

test('set then get round-trips; rejects bad numbers', async () => {
  const redis = store();
  assert.ok((await setPricing({ firstChargeCents: 10000, monthlyCents: 2500 }, 'justin', { redis })).pricing);
  const p = await getPricing({ redis });
  assert.equal(p.firstChargeCents, 10000); assert.equal(p.activationCents, 7500); assert.equal(p.updatedBy, 'justin');
  for (const bad of [{ firstChargeCents: 1000, monthlyCents: 2500 }, { firstChargeCents: 5000, monthlyCents: 100 }, { firstChargeCents: 'x', monthlyCents: 2500 }, { firstChargeCents: 5000.5, monthlyCents: 2500 }, { firstChargeCents: 999999, monthlyCents: 2500 }])
    assert.ok(validatePricing(bad).error, JSON.stringify(bad));
});

test('checkout and pitch follow the saved price', async () => {
  const redis = store(); await setPricing({ firstChargeCents: 10000, monthlyCents: 3000 }, 'j', { redis });
  const p = await getPricing({ redis });
  const [m, s] = checkoutLineItems({ tier: 'launch' }, {}, p).map(i => i.price_data.unit_amount);
  assert.equal(m, 3000); assert.equal(s, 7000);
  assert.equal(offerFromPricing(p).tiers[0].signUpCents, 10000);
  process.env.FORGE_LAUNCH_ENABLED = 'true';
  const line = generatePitchScript({ businessName: 'X', category: 'barber' }, p).pricingLine;
  assert.match(line, /\$100 total at signup.*\$30\/month/);
});

test('only managers can change it; workers can read', async () => {
  const base = { get: async () => ({ firstChargeCents: 5000 }), set: async () => ({ pricing: { ok: 1 } }) };
  let r = res(); await createForgePricingHandler({ ...base, user: async () => 'c', manager: async () => false, worker: async () => true })(post({}), r); assert.equal(r.code, 403);
  r = res(); await createForgePricingHandler({ ...base, user: async () => 'c', manager: async () => false, worker: async () => true })({ method: 'GET', headers: {} }, r); assert.equal(r.code, 200);
  r = res(); await createForgePricingHandler({ ...base, user: async () => 'j', manager: async () => true, worker: async () => true })(post({}), r); assert.equal(r.code, 200);
  r = res(); await createForgePricingHandler({ ...base, user: async () => null })(post({}), r); assert.equal(r.code, 401);
});
