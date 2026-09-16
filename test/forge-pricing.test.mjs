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
  // Built from the pricing constant rather than hardcoded, so the page copy
  // and lib/forgePricing.js cannot drift apart again. They had drifted: the
  // page said $6 (correct — it matches the live Stripe price) while the
  // constant said $4, so the usage API advertised a cheaper pack than
  // customers were actually charged at checkout.
  const expected = 'Usage packs add ' + pricing.usagePack.credits
    + ' build credits for $' + pricing.usagePack.priceUsd;
  assert.ok(
    source.includes(expected),
    'room-login.html copy must match canonical Forge pricing, got no match for: ' + expected,
  );
});
