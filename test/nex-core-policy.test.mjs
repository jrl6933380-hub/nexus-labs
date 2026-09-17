import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { NEX_CORE_POLICY, compactNexIdentity } from '../lib/nexCorePolicy.js';

test('compact identity keeps identity/operator/tone and leaves product manuals retrievable elsewhere', async () => {
  const source = await readFile(new URL('../IDENTITY.md', import.meta.url), 'utf8');
  const compact = compactNexIdentity(source);
  assert.match(compact, /What I am/);
  assert.match(compact, /Who I answer to/);
  assert.match(compact, /Tone/);
  assert.doesNotMatch(compact, /Nexus Forge — what it actually is/);
  assert.ok(compact.length < source.length / 2);
});

test('core policy contains the enforced reason-act-verify contract without the old tool manual', () => {
  assert.match(NEX_CORE_POLICY, /Use tool_search only when/);
  assert.match(NEX_CORE_POLICY, /completion conditions pass/);
  assert.match(NEX_CORE_POLICY, /backend evidence gate is authoritative/);
  assert.ok(NEX_CORE_POLICY.length < 4000);
});

test('the live model prompt is assembled from compact policy, not the legacy monolith', async () => {
  const source = await readFile(new URL('../lib/nexBrain.js', import.meta.url), 'utf8');
  assert.match(source, /stableSystemText = \[identityText, NEX_CORE_POLICY/u);
  assert.doesNotMatch(source, /const systemPrompt =/u);
});
