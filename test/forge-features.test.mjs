import test from 'node:test';
import assert from 'node:assert/strict';

import { canUseFeature, describeFeatures, featuresForTier, tierRank } from '../lib/forge/features.js';

const free = { connected: true, tier: 'free' };
const fast = { connected: true, tier: 'fast' };
const strong = { connected: true, tier: 'strong' };

test('no connection locks everything, including the free features', () => {
  // Not a paywall: Forge runs nothing on the owner's credentials, so without
  // a brain there is genuinely nothing to serve the request.
  for (const id of ['build', 'edit', 'brief', 'stack']) {
    const verdict = canUseFeature(null, id);
    assert.equal(verdict.allowed, false, `${id} must be locked without a brain`);
    assert.equal(verdict.needsConnection, true);
  }
});

test('a disconnected record is treated as no connection', () => {
  assert.equal(canUseFeature({ connected: false, tier: 'strong' }, 'build').allowed, false);
});

test('free builds and edits but does not plan', () => {
  assert.equal(canUseFeature(free, 'build').allowed, true);
  assert.equal(canUseFeature(free, 'edit').allowed, true);
  assert.equal(canUseFeature(free, 'brief').allowed, false);
  assert.equal(canUseFeature(free, 'stack').allowed, false);
});

test('fast unlocks the Project Brief but not full stack setup', () => {
  assert.equal(canUseFeature(fast, 'brief').allowed, true);
  assert.equal(canUseFeature(fast, 'stack').allowed, false);
});

test('strong unlocks everything', () => {
  for (const id of ['build', 'edit', 'brief', 'stack']) {
    assert.equal(canUseFeature(strong, id).allowed, true, id);
  }
});

test('tiers are supersets — upgrading never takes a feature away', () => {
  const tiers = [free, fast, strong];
  for (let i = 1; i < tiers.length; i++) {
    const lower = describeFeatures(tiers[i - 1]).filter((feature) => feature.unlocked);
    const higher = describeFeatures(tiers[i]);
    for (const feature of lower) {
      const match = higher.find((candidate) => candidate.id === feature.id);
      assert.equal(match.unlocked, true, `${feature.id} must stay unlocked after an upgrade`);
    }
  }
});

test('an unrecognised tier unlocks nothing beyond the baseline', () => {
  const bogus = { connected: true, tier: 'platinum' };
  assert.equal(tierRank('platinum'), -1);
  assert.equal(canUseFeature(bogus, 'brief').allowed, false);
  assert.equal(canUseFeature(bogus, 'stack').allowed, false);
});

test('every locked feature explains the real constraint', () => {
  for (const feature of describeFeatures(free).filter((candidate) => !candidate.unlocked)) {
    assert.ok(feature.reason && feature.reason.length > 10, `${feature.id} needs a real reason`);
    assert.ok(
      !/more power/i.test(feature.reason),
      'the reason must name the actual constraint, not read as a vague upsell'
    );
  }
});

test('an unknown feature id is refused rather than allowed through', () => {
  assert.equal(canUseFeature(strong, 'delete_everything').allowed, false);
});

test('featuresForTier reports what an upgrade actually buys', () => {
  const freeNames = featuresForTier('free');
  const fastNames = featuresForTier('fast');
  assert.ok(fastNames.length > freeNames.length);
  assert.ok(fastNames.includes('Project Brief'));
  assert.ok(!freeNames.includes('Project Brief'));
});
