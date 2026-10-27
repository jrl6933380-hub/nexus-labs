import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchStore, SEARCH_COST } from '../lib/researchJobs.js';

function memory() {
  const h = new Map();
  return async (parts) => {
    const [cmd, , ...rest] = parts;
    if (cmd === 'HGET') return h.get(rest[0]) ?? null;
    if (cmd === 'HVALS') return [...h.values()];
    if (cmd === 'HDEL') { h.delete(rest[0]); return 1; }
    if (cmd === 'EVAL') {
      const [field, old, next, limit] = [parts[4], parts[5], parts[6], parts[7]];
      const cur = h.get(field) ?? '';
      if (cur !== old) return 0;
      if (cur === '' && h.size >= Number(limit)) return -1;
      h.set(field, next); return 1;
    }
    throw new Error('unexpected ' + cmd);
  };
}
const setup = () => createResearchStore({ command: memory(), wake: async () => ({ woke: false }) });

test('a credits link needs exactly one of runs or credits', async () => {
  const s = setup();
  await assert.rejects(() => s.createLink({ label: 'x' }));
  await assert.rejects(() => s.createLink({ label: 'x', runs: 2, credits: 10 }));
  const l = await s.createLink({ label: 'Wallet', credits: 20 });
  assert.equal(l.credits, 20);
  assert.equal(l.search_cost, SEARCH_COST);
});

test('a search spends 8 credits and stops when the wallet is too low', async () => {
  const s = setup();
  const { token } = await s.createLink({ label: 'W', credits: 20 });
  const a = await s.submit(token, { competitor: 'Casey' });
  assert.equal(a.credits_left, 12);
  const b = await s.submit(token, { competitor: 'Walmart' });
  assert.equal(b.credits_left, 4);
  await assert.rejects(() => s.submit(token, { competitor: 'Third' }), (e) => e.code === 'NO_CREDITS' && e.status === 402);
  const st = await s.status(token, { job_id: a.job_id });
  assert.equal(st.credits_left, 4);
  assert.equal(st.wallet, true);
});

test('a failed search puts the credits back once', async () => {
  const s = setup();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 16 });
  const { job_id } = await s.submit(token, { competitor: 'Casey' });
  await s.claim({ job_id });
  const r = await s.complete({ job_id, error: 'blocked by site' });
  assert.equal(r.refunded, true);
  assert.equal((await s.walletInfo({ link_id })).credits, 16);
  const st = await s.status(token, { job_id });
  assert.match(st.error, /credits were put back/);
});

test('a finished search keeps its cost', async () => {
  const s = setup();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 16 });
  const { job_id } = await s.submit(token, { competitor: 'Casey' });
  await s.claim({ job_id });
  await s.complete({ job_id, result: { summary: 'ok' } });
  assert.equal((await s.walletInfo({ link_id })).credits, 8);
});

test('adding credits is safe to repeat with the same ref', async () => {
  const s = setup();
  const { link_id } = await s.createLink({ label: 'W', credits: 8 });
  assert.equal((await s.addCredits({ link_id, credits: 50, ref: 'cs_test_123' })).credits, 58);
  assert.equal((await s.addCredits({ link_id, credits: 50, ref: 'cs_test_123' })).credits, 58);
  const info = await s.walletInfo({ link_id });
  assert.equal(info.ledger.length, 2);
});

test('old fixed-run links still work and cannot take credits', async () => {
  const s = setup();
  const { token, link_id } = await s.createLink({ label: 'Old', runs: 1 });
  const a = await s.submit(token, { competitor: 'Casey' });
  assert.equal(a.runs_left, 0);
  assert.equal(a.wallet, undefined);
  await assert.rejects(() => s.submit(token, { competitor: 'Again' }), (e) => e.code === 'NO_RUNS_LEFT');
  await assert.rejects(() => s.addCredits({ link_id, credits: 5, ref: 'abcd1' }), (e) => e.code === 'NOT_WALLET');
});
