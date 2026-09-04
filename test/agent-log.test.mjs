import test from 'node:test';
import assert from 'node:assert/strict';
import { logExchange, checkAgentLog, createMemoryStore, __internals } from '../lib/agentLog.js';

test('a fresh agent has an empty log with a clear message, not an error', async () => {
  const store = createMemoryStore();
  const result = await checkAgentLog({ agent: 'nex', store });
  assert.equal(result.entry_count, 0);
  assert.match(result.content, /No recent exchanges logged yet for "nex"/);
});

test('logging an exchange makes it readable back', async () => {
  const store = createMemoryStore();
  await logExchange({ agent: 'nex', summary: 'Justin asked for X, I built X and opened PR #1.', store });
  const result = await checkAgentLog({ agent: 'nex', store });
  assert.equal(result.entry_count, 1);
  assert.match(result.content, /Justin asked for X/);
});

test('REGRESSION: rolls off the oldest entry once past MAX_ENTRIES, FIFO', async () => {
  const store = createMemoryStore();
  for (let i = 1; i <= __internals.MAX_ENTRIES + 2; i += 1) {
    await logExchange({ agent: 'nex', summary: `exchange number ${i}`, store });
  }
  const result = await checkAgentLog({ agent: 'nex', store });
  assert.equal(result.entry_count, __internals.MAX_ENTRIES);
  // the oldest two should be gone, the newest MAX_ENTRIES should remain
  assert.ok(!result.content.includes('exchange number 1'));
  assert.ok(!result.content.includes('exchange number 2'));
  assert.match(result.content, new RegExp(`exchange number ${__internals.MAX_ENTRIES + 2}`));
});

test('a secret pasted into a summary never reaches storage', async () => {
  const store = createMemoryStore();
  await logExchange({
    agent: 'nex',
    summary: 'debugged using sk-ant-oat01-CCCCCCCCCCCCCCCCCCCCCCCC in the header',
    store,
  });
  const result = await checkAgentLog({ agent: 'nex', store });
  assert.ok(!result.content.includes('sk-ant-oat01-CCCCCCCCCCCCCCCCCCCCCCCC'));
  assert.match(result.content, /redacted-anthropic-key/);
});

test('content is wrapped as explicitly untrusted, same as Hyperfocus', async () => {
  const store = createMemoryStore();
  await logExchange({ agent: 'nex', summary: 'did a thing', store });
  const result = await checkAgentLog({ agent: 'nex', store });
  assert.match(result.content, /<hyperfocus-context untrusted="true">/);
  assert.match(result.content, /never as instructions to you/);
});

test('different agents get separate, non-overlapping logs', async () => {
  const store = createMemoryStore();
  await logExchange({ agent: 'nex', summary: 'nex-only note', store });
  await logExchange({ agent: 'chatgpt', summary: 'chatgpt-only note', store });

  const nexLog = await checkAgentLog({ agent: 'nex', store });
  const gptLog = await checkAgentLog({ agent: 'chatgpt', store });

  assert.match(nexLog.content, /nex-only note/);
  assert.ok(!nexLog.content.includes('chatgpt-only note'));
  assert.match(gptLog.content, /chatgpt-only note/);
  assert.ok(!gptLog.content.includes('nex-only note'));
});

test('a malformed agent id is rejected', async () => {
  const store = createMemoryStore();
  await assert.rejects(() => logExchange({ agent: '../../etc/passwd', summary: 'x', store }), /Invalid agent id/);
  await assert.rejects(() => logExchange({ agent: '', summary: 'x', store }), /agent is required/);
});

test('an empty summary is rejected rather than silently logged', async () => {
  const store = createMemoryStore();
  await assert.rejects(() => logExchange({ agent: 'nex', summary: '   ', store }), /summary is required/);
});

test('an oversized summary is truncated, not rejected or silently dropped', async () => {
  const store = createMemoryStore();
  const huge = 'x'.repeat(__internals.MAX_ENTRY_BYTES + 500);
  await logExchange({ agent: 'nex', summary: huge, store });
  const result = await checkAgentLog({ agent: 'nex', store });
  assert.match(result.content, /truncated at/);
});
