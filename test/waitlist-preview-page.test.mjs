import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaitlistStore, MAX_PREVIEW_CHARS } from '../lib/waitlist.js';
import { handleWaitlist } from '../api/waitlist.js';
import { createWorkspaceService } from '../lib/workspaceConnector.js';

function fakeRedis() {
  const kv = new Map(); const lists = new Map();
  return async (p) => {
    const [c, k, a, b] = p;
    if (c === 'SET') { if (p.includes('NX') && kv.has(k)) return null; kv.set(k, a); return 'OK'; }
    if (c === 'GET') return kv.has(k) ? kv.get(k) : null;
    if (c === 'DEL') { kv.delete(k); return 1; }
    if (c === 'RPUSH') { const l = lists.get(k) || []; l.push(a); lists.set(k, l); return l.length; }
    if (c === 'LRANGE') return (lists.get(k) || []).slice(Number(a), Number(b) + 1);
    if (c === 'LSET') { lists.get(k)[Number(a)] = b; return 'OK'; }
    if (c === 'LLEN') return (lists.get(k) || []).length;
    throw new Error('unexpected ' + c);
  };
}
const mockRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.sent = b; return r; } }; return r; };
const entry = { name: 'Sam', business: 'Sam Lawn Care', kind: 'website', what: 'A simple site with my services', extra: '', links: '', email: 'sam@example.com', phone: '', consent: true };
const HTML = '<!doctype html><title>x</title><p>Concept preview made by Nexus. Not a live site.</p>';

async function setup() {
  const store = createWaitlistStore({ command: fakeRedis() });
  const { id } = await store.add(entry, []);
  return { store, id };
}

test('store saves and reads a preview, rejects bad, empty and oversized input', async () => {
  const { store, id } = await setup();
  assert.equal(await store.getPreview(id), null);
  assert.equal(await store.savePreview(id, HTML), true);
  assert.equal(await store.getPreview(id), HTML);
  assert.equal(await store.savePreview('not an id', HTML), false);
  assert.equal(await store.savePreview(id, '   '), false);
  assert.equal(await store.savePreview(id, 'x'.repeat(MAX_PREVIEW_CHARS + 1)), false);
});

test('public preview is served sandboxed once the entry is preview_sent', async () => {
  const { store, id } = await setup();
  await store.savePreview(id, HTML);
  const early = mockRes();
  await handleWaitlist({ method: 'GET', query: { preview: id }, headers: {} }, early, { store });
  assert.equal(early.code, 404, 'not public while the entry is still waiting');
  await store.update(id, { status: 'preview_sent' });
  const res = mockRes();
  await handleWaitlist({ method: 'GET', query: { preview: id }, headers: {} }, res, { store });
  assert.equal(res.code, 200);
  assert.equal(res.sent, HTML);
  assert.match(res.headers['Content-Type'], /text\/html/);
  const csp = res.headers['Content-Security-Policy'];
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(res.headers['X-Robots-Tag'], /noindex/);
});

test('preview 404s for bad ids, unknown ids, passed entries and missing pages', async () => {
  const { store, id } = await setup();
  for (const q of ['nope', '123e4567-e89b-12d3-a456-426614174999']) {
    const r = mockRes();
    await handleWaitlist({ method: 'GET', query: { preview: q }, headers: {} }, r, { store });
    assert.equal(r.code, 404);
  }
  await store.update(id, { status: 'preview_sent' });
  const noPage = mockRes();
  await handleWaitlist({ method: 'GET', query: { preview: id }, headers: {} }, noPage, { store });
  assert.equal(noPage.code, 404);
  await store.savePreview(id, HTML);
  await store.update(id, { status: 'passed' });
  const passed = mockRes();
  await handleWaitlist({ method: 'GET', query: { preview: id }, headers: {} }, passed, { store });
  assert.equal(passed.code, 404);
});

const owner = { id: 'acct', owner: true, workbenchUserId: 'w', scheduleUserId: 's' };

test('save_waitlist_preview saves the page, sets preview_sent and puts the public link in the note', async () => {
  const { store, id } = await setup();
  const execute = createWorkspaceService({ waitlist: store });
  const out = await execute('save_waitlist_preview', { entry_id: id, html: HTML }, owner);
  assert.equal(out.status, 'preview_sent');
  assert.equal(out.preview_url, 'https://nexus-labs-sigma.vercel.app/p/' + id);
  const saved = await store.get(id);
  assert.equal(saved.status, 'preview_sent');
  assert.equal(saved.note, out.preview_url);
  assert.equal(await store.getPreview(id), HTML);
});

test('save_waitlist_preview is owner only and validates input', async () => {
  const { store, id } = await setup();
  const execute = createWorkspaceService({ waitlist: store });
  await assert.rejects(execute('save_waitlist_preview', { entry_id: id, html: HTML }, { ...owner, owner: false }), /owner/i);
  await assert.rejects(execute('save_waitlist_preview', { entry_id: '123e4567-e89b-12d3-a456-426614174999', html: HTML }, owner), /No waitlist entry/);
  await assert.rejects(execute('save_waitlist_preview', { entry_id: id, html: '  ' }, owner));
  await assert.rejects(execute('save_waitlist_preview', { entry_id: id, html: 'x'.repeat(MAX_PREVIEW_CHARS + 1) }, owner), /too large/);
  assert.equal((await store.get(id)).status, 'waiting');
});
