import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FORGE_CREDIT_PRICING, publicForgePricing } from '../lib/forgePricing.js';
import { createRoomMeter } from '../lib/roomMetering.js';
import { createUsageHandler } from '../api/room-usage.js';

test('Forge pricing has permanent action costs and a meaningful $4 pack', () => {
  assert.deepEqual(FORGE_CREDIT_PRICING, {
    freshBuild: 15,
    edit: 2,
    assistant: 1,
    usagePack: { priceUsd: 4, credits: 30 },
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
  let body;
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return value; },
  };
  await handler({ method: 'GET' }, res);
  assert.equal(statusCode, 200);
  assert.deepEqual(body.pricing, publicForgePricing());
});

test('new-account tier screen explains build costs and usage-pack value', async () => {
  const source = await readFile(new URL('../public/room-login.html', import.meta.url), 'utf8');
  assert.match(source, /15 credits per new build · 2 per edit/);
  assert.match(source, /Usage packs add 30 build credits for \$4/);
});
