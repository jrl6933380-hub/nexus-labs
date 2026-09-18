import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryForRun } from '../public/nex-chat-bar.js';
import { requestKey, chatRequest } from '../lib/nexChatRequests.js';

test('only a saved resumable pause offers Continue', () => {
  for (const blocker of ['model_step_budget_exhausted', 'tool_call_budget_exhausted', 'reasoning_time_budget_exhausted', 'completion_not_verified', 'missing_evidence:tests']) {
    assert.equal(recoveryForRun({ state: 'waiting', runId: 'nex-turn-123', blocker }).canContinue, true);
  }
  for (const state of ['blocked', 'failed', 'cancelled']) {
    assert.equal(recoveryForRun({ state, runId: 'nex-turn-123', blocker: 'model_step_budget_exhausted' }).canContinue, false);
  }
  assert.equal(recoveryForRun({ state: 'waiting', blocker: 'model_step_budget_exhausted' }).canContinue, false);
  assert.equal(recoveryForRun({ state: 'waiting', runId: 'nex-turn-123', blocker: 'latest_tool_failed' }).canContinue, false);
  assert.equal(recoveryForRun({ state: 'completed' }), null);
});

test('recovery records are scoped to authenticated operator and reject malformed ids', () => {
  assert.notEqual(requestKey('owner', '12345678-12345678'), requestKey('other', '12345678-12345678'));
  assert.throws(() => requestKey('owner', '../secret'));
  assert.throws(() => requestKey('', '12345678-12345678'));
});

test('request status saves result with expiry and reads it without executing work', async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.KV_REST_API_URL;
  const oldToken = process.env.KV_REST_API_TOKEN;
  process.env.KV_REST_API_URL = 'https://example.invalid';
  process.env.KV_REST_API_TOKEN = 'test';
  const commands = [];
  let saved;
  globalThis.fetch = async (_url, options) => {
    const command = JSON.parse(options.body); commands.push(command);
    if (command[0] === 'SET') saved = command[2];
    return { ok: true, json: async () => ({ result: command[0] === 'GET' ? saved : 'OK' }) };
  };
  try {
    const value = { state: 'finished', response: { reply: 'done' } };
    await chatRequest('owner', '12345678-12345678', value);
    assert.deepEqual(await chatRequest('owner', '12345678-12345678'), value);
    assert.deepEqual(commands.map(c => c[0]), ['SET', 'GET']);
    assert.deepEqual(commands[0].slice(-2), ['EX', 86400]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = oldUrl;
    if (oldToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = oldToken;
  }
});
