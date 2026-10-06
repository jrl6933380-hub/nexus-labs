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
  assert.match(policy, /provider-neutral packet/i);
  assert.match(policy, /credentials and sensitive authentication material out of prompts/i);
});

test('ordinary owner build requests are not forced through a handoff gate', async () => {
  const chatSource = await readFile(new URL('../api/chat.js', import.meta.url), 'utf8');

  assert.doesNotMatch(chatSource, /buildHandoffDirective|## Handoff Gate/);
  const policy = getNexRuntimePolicy();
  assert.match(policy, /unless Justin explicitly asks for another agent or a team/i);
  assert.match(policy, /Direct execution is the default/i);
});

test('retired provider-specific mode gates are absent from owner chat', async () => {
  const chatSource = await readFile(new URL('../api/chat.js', import.meta.url), 'utf8');
  assert.doesNotMatch(chatSource, /isDisengageCommand|detectHyperfocusTrigger|startClaudeHandoff/);
  assert.match(chatSource, /if \(buildStreamStarted\) \{\n\s+sendBuildEvent\('error'/);
});
