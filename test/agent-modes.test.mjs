import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_MODES,
  DEFAULT_ROUTES,
  DEFAULT_MODE,
  isKnownMode,
  publicAgentModes,
  resolveModel,
} from '../lib/forge/agentModes.js';

// These run with no KV configured, so getRoutes() falls back to defaults.
// That fallback is itself the most important thing under test: an empty or
// unreachable controller must leave Forge running on the CHEAP end, never the
// expensive one.

test('the customer-facing mode list carries no model ids', () => {
  const serialized = JSON.stringify(publicAgentModes());
  assert.ok(!serialized.includes('claude'), 'a mode picker must describe goals, not model names');
  assert.ok(!serialized.includes('/'), 'no provider/model slugs should reach the customer');
});

test('every mode states a goal, not a mechanism', () => {
  for (const mode of Object.values(AGENT_MODES)) {
    assert.ok(mode.goal && mode.goal.length > 0, `${mode.id} needs a goal`);
    assert.ok(mode.label && mode.label.length > 0);
  }
});

test('the free mode is honest about its ceiling', () => {
  // A free tier that implies production-grade output sets someone up to
  // conclude the product is broken when a cheap model gives a cheap result.
  assert.match(AGENT_MODES.free.note, /lightweight|small changes|starting/i);
  assert.equal(AGENT_MODES.free.paid, false);
});

test('an unknown mode falls back to the default rather than throwing', async () => {
  const resolved = await resolveModel({ mode: 'enterprise-ultra', kind: 'build' });
  assert.equal(resolved.mode, DEFAULT_MODE);
  assert.equal(resolved.model, DEFAULT_ROUTES[DEFAULT_MODE].build);
});

test('chat on a paid mode routes cheaper than a build on the same mode', async () => {
  const build = await resolveModel({ mode: 'power', kind: 'build' });
  const chat = await resolveModel({ mode: 'power', kind: 'chat' });
  assert.notEqual(chat.model, build.model,
    'conversation is the majority of requests and the cheapest kind of work');
});

test('a templated build on a paid mode drops a tier', async () => {
  const scratch = await resolveModel({ mode: 'max', kind: 'build', templateMatched: false });
  const templated = await resolveModel({ mode: 'max', kind: 'build', templateMatched: true });
  assert.equal(scratch.routedAs, 'max');
  assert.equal(templated.routedAs, 'power');
  assert.equal(templated.auto, true);
});

test('free never routes below itself', async () => {
  const templated = await resolveModel({ mode: 'free', kind: 'build', templateMatched: true });
  assert.equal(templated.routedAs, 'free', 'there is nothing below free to drop to');
  assert.equal(templated.model, DEFAULT_ROUTES.free.build);
});

test('a from-scratch build keeps its full tier', async () => {
  // This is exactly the case that needs the headroom, so Auto must not
  // economise on it.
  const resolved = await resolveModel({ mode: 'max', kind: 'build', templateMatched: false });
  assert.equal(resolved.model, DEFAULT_ROUTES.max.build);
  assert.equal(resolved.auto, false);
});

test('isKnownMode rejects junk', () => {
  assert.equal(isKnownMode('free'), true);
  assert.equal(isKnownMode('toString'), false, 'prototype keys must not read as modes');
  assert.equal(isKnownMode(null), false);
  assert.equal(isKnownMode(''), false);
});
