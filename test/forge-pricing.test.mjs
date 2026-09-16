import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FORGE_CREDIT_PRICING, publicForgePricing } from '../lib/forgePricing.js';
import { createRoomMeter } from '../lib/roomMetering.js';
import { createUsageHandler } from '../api/room-usage.js';

test('Forge pricing has permanent action costs and a meaningful pack', () => {
  // priceUsd must stay in step with the live Stripe price for
  // CREDIT_PACK_PRICE_ID (price_1UEjoFDh5Di7LYi3DGorrLRb, unit_amount 600).
  assert.deepEqual(FORGE_CREDIT_PRICING, {
    freshBuild: 15,
    edit: 2,
    assistant: 1,
    usagePack: { priceUsd: 6, credits: 30 },
  });
});

test('Room metering defaults are sourced from canonical Forge pricing', () => {
  const meter = createRoomMeter({ command: async () => { throw new Error('not used'); } });
  assert.equal(meter.settings.freshBuildCredits, 15);
  assert.equal(meter.settings.editCredits, 2);
  assert.equal(meter.settings.assistantCredits, 1);
});

test('usage API publishes pricing beside the signed-in account balance', async () => {
  const handler = createUsageHandler({
    resolveUser: async () => 'alice',
    meter: {
      getUsageSummary: async () => ({ limit: 30, remaining: 15 }),
      getDailyUsageSummary: async () => ({ unlimited: false, percentRemaining: 50 }),
    },
  });
  let statusCode = 0;
  let body = null;
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await handler({ method: 'GET', headers: {}, cookies: {} }, res);
  assert.equal(statusCode, 200);
  assert.deepEqual(body.pricing, publicForgePricing());
});

test('new-account tier screen explains build costs and usage-pack value', async () => {
  const source = await readFile(new URL('../public/room-login.html', import.meta.url), 'utf8');
  const pricing = publicForgePricing();
  assert.match(source, /15 credits per new build · 2 per edit/);

  // The page renders these from /api/room-usage at load, but the figures in
  // the markup are the offline fallback — so they still have to be right.
  // Checked against the canonical constant rather than restated here, since
  // the two previously drifted ($6 on the page vs $4 in the constant) and the
  // builder UI advertised a cheaper pack than checkout actually charged.
  const packCredits = [...source.matchAll(/data-pricing="packCredits"[^>]*>([^<]*)</gu)].map((m) => m[1]);
  const packPrices = [...source.matchAll(/data-pricing="packPrice"[^>]*>([^<]*)</gu)].map((m) => m[1]);
  assert.ok(packCredits.length > 0, 'expected usage-pack credit figures to be marked with data-pricing');
  assert.ok(packPrices.length > 0, 'expected usage-pack price figures to be marked with data-pricing');
  for (const value of packCredits) {
    assert.equal(value, String(pricing.usagePack.credits), 'fallback credit figure must match canonical pricing');
  }
  for (const value of packPrices) {
    assert.equal(value, String(pricing.usagePack.priceUsd), 'fallback price figure must match canonical pricing');
  }

  // And the buy button must point at the credit-pack price, so the copy and
  // the thing it charges cannot describe different products.
  assert.match(source, /data-checkout="price_1UEjoFDh5Di7LYi3DGorrLRb"/);
});
