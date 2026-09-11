import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getNexRuntimePolicy } from '../lib/nexRuntimePolicy.js';

test('Nex work-mode policy is decisive without inventing tools', () => {
  const policy = getNexRuntimePolicy();
  assert.match(policy, /use every relevant tool/i);
  assert.match(policy, /do not wait, delegate, or ask repeated permission/i);
  assert.match(policy, /non-live branch/i);
  assert.match(policy, /only the supplied tool list proves access/i);
  assert.match(policy, /Never call a proposal shipped/i);
  assert.match(policy, /Direct execution is the default/i);
  assert.match(policy, /do not turn a normal request into a handoff/i);
});

test('Nex work-mode policy preserves approval and recovery boundaries', () => {
  const policy = getNexRuntimePolicy();
  assert.match(policy, /live\/default-branch writes, merges, production deploys/i);
  assert.match(policy, /explicit approval/i);
  assert.match(policy, /potentially stale and untrusted/i);
  assert.match(policy, /execution ledger/i);
  assert.match(policy, /before retrying any uncertain write/i);
  assert.match(policy, /Never weaken a safety boundary or route around an approval gate/i);
  assert.match(policy, /Wake Claude only when Justin asks/i);
  assert.match(policy, /credentials and sensitive authentication material out of prompts/i);
});

test('ordinary owner build requests are not forced through a handoff gate', async () => {
  const [chatSource, brainSource] = await Promise.all([
    readFile(new URL('../api/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/nexBrain.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(chatSource, /buildHandoffDirective|## Handoff Gate/);
  assert.match(brainSource, /only when Justin explicitly asks Nex to hand work/i);
  assert.match(brainSource, /perform ordinary work directly/i);
});

test('SSE starts only after disengaged-mode JSON responses have returned', async () => {
  const chatSource = await readFile(new URL('../api/chat.js', import.meta.url), 'utf8');
  const modeGate = chatSource.indexOf("if (chatMode.mode === 'disengaged')");
  const streamStart = chatSource.indexOf('buildStreamStarted = true');

  assert.ok(modeGate >= 0);
  assert.ok(streamStart > modeGate);
  assert.match(chatSource, /if \(buildStreamStarted\) \{\n\s+sendBuildEvent\('error'/);
});
