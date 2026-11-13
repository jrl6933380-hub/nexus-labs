import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, listEntries, parseTimelineMessage, buildEntry, TIMELINE_LIMIT } from '../lib/timeline.js';
import { createTimelineHandler } from '../api/timeline.js';

const fake = () => { const l = []; return async c => { if (c[0] === 'LPUSH') { l.unshift(c[2]); return l.length; } if (c[0] === 'LTRIM') { l.length = Math.min(l.length, Number(c[3]) + 1); return 'OK'; } if (c[0] === 'LRANGE') return l.slice(0, Number(c[3]) + 1); } };
const res = () => { const r = { setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

test('entries save newest first and keep who/when/what/next', async () => {
  const redis = fake(); let t = 1000;
  await addEntry({ by: 'Justin', did: 'Shipped demo links', next: 'Guided editor' }, { redis, now: () => t++ });
  await addEntry({ by: 'claude', did: 'Merged photos', kind: 'agent' }, { redis, now: () => t++ });
  const e = await listEntries(10, { redis });
  assert.equal(e.length, 2); assert.equal(e[0].by, 'claude'); assert.equal(e[1].by, 'justin'); assert.equal(e[1].next, 'Guided editor');
});

test('empty entries are refused; secrets are redacted', () => {
  assert.ok(buildEntry({ by: 'justin', did: '   ' }).error);
  const e = buildEntry({ by: 'justin', did: 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD here' }).entry;
  assert.ok(!e.did.includes('abcdefghijklmnopqrstuvwxyz0123456789'), e.did);
});

test('[TIMELINE] board messages parse into agent entries, other messages do not', () => {
  assert.equal(parseTimelineMessage('claude', 'hello there'), null);
  const p = parseTimelineMessage('claude', '[TIMELINE] Merged #946. NEXT: guided editor');
  assert.deepEqual(p, { by: 'claude', did: 'Merged #946.', next: 'guided editor', kind: 'agent' });
  assert.equal(parseTimelineMessage('chatgpt', '[timeline] only did').next, '');
});

test('list is capped at the limit constant', () => assert.equal(TIMELINE_LIMIT, 1000));

test('API: owner or agent token reads; only the owner saves; same-origin required', async () => {
  const base = { list: async () => [{ id: 'a' }], add: async x => ({ entry: { ...x, id: 'n' } }) };
  const post = { method: 'POST', headers: { origin: 'https://x.test', host: 'x.test' }, body: { did: 'x' } };
  let r = res(); await createTimelineHandler({ ...base, owner: async () => null, agent: () => false })({ method: 'GET', headers: {}, query: {} }, r); assert.equal(r.code, 401);
  r = res(); await createTimelineHandler({ ...base, owner: async () => null, agent: () => true })({ method: 'GET', headers: {}, query: {} }, r); assert.equal(r.code, 200);
  r = res(); await createTimelineHandler({ ...base, owner: async () => null, agent: () => true })(post, r); assert.equal(r.code, 403);
  r = res(); await createTimelineHandler({ ...base, owner: async () => ({ id: 'j' }), agent: () => false })(post, r); assert.equal(r.code, 200); assert.equal(r.body.entry.by, 'justin');
  r = res(); await createTimelineHandler({ ...base, owner: async () => ({ id: 'j' }), agent: () => false })({ ...post, headers: { origin: 'https://evil.test', host: 'x.test' } }, r); assert.equal(r.code, 403);
});
