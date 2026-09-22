import test from 'node:test';
import assert from 'node:assert/strict';

import { createRoomMeter } from '../lib/roomMetering.js';
import { FORGE_CREDIT_PRICING } from '../lib/forgePricing.js';

// These assert the SHAPE of the free allowance, not just its total. The total
// is a tuning number; the shape is the product decision — enough to reach a
// page that works, not enough to polish it to finished.

test('the free allowance covers exactly one build', () => {
  const { settings } = createRoomMeter();
  const builds = Math.floor(settings.dailyCreditsLimit / settings.freshBuildCredits);
  assert.equal(builds, 2 - 1, 'one full build, and not a second');
});

test('after one build there is room for four edits', () => {
  const { settings } = createRoomMeter();
  const afterBuild = settings.dailyCreditsLimit - settings.freshBuildCredits;
  const edits = Math.floor(afterBuild / settings.editCredits);
  assert.ok(edits >= 4, `expected at least 4 edits after a build, got ${edits}`);
  assert.ok(edits < 10,
    'ten edits finishes most small pages, which removes the reason to upgrade');
});

test('a build plus its edits still leaves room to talk to Nex', () => {
  const { settings } = createRoomMeter();
  const spent = settings.freshBuildCredits + (4 * settings.editCredits);
  const chatTurns = Math.floor((settings.dailyCreditsLimit - spent) / settings.assistantCredits);
  assert.ok(chatTurns >= 5,
    'asking what Forge can do should not eat the build someone came for');
});

test('an edit is much cheaper than a build', () => {
  // Edits are where someone gets the page RIGHT. Pricing them near a build
  // would mean the allowance runs out mid-repair, leaving a broken page —
  // which is a reason to leave rather than a reason to pay.
  assert.ok(FORGE_CREDIT_PRICING.edit * 5 < FORGE_CREDIT_PRICING.freshBuild);
});

test('the platform ceiling is far above one account exhausting itself', () => {
  const { settings } = createRoomMeter();
  const accountsToTrip = settings.globalDailyCreditCeiling / settings.dailyCreditsLimit;
  assert.ok(accountsToTrip > 100,
    'the global ceiling is a brake for when something is wrong, not a limit real usage should meet');
});
