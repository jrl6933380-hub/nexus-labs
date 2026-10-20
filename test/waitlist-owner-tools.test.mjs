import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWaitlistStore, validateWaitlistEntry } from '../lib/waitlist.js';
import { createWorkspaceService, WORKSPACE_ACTIONS, WORKSPACE_WRITES } from '../lib/workspaceConnector.js';
import { WORKSPACE_TOOLS } from '../lib/workspaceBoard.js';

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const owner = { id: 'justin', owner: true, workbenchUserId: 'justin', scheduleUserId: 'owner:justin' };
const customer = { id: 'customer:bob', owner: false, workbenchUserId: 'bob', scheduleUserId: 'room:bob' };

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
async function setup() {
  let n = 0;
  const store = createWaitlistStore({ command: fakeRedis(), now: () => 1_800_000_000_000 + n, id: () => 'aaaaaaaa-' + (++n) });
  const add = (extra, photos) => store.add(validateWaitlistEntry({ what: 'A website for my lawn care business', kind: 'website', consent: true, ...extra }).entry, photos);
  await add({ email: 'a@example.com', business: 'Alpha Lawn', extra: 'green logo' }, [jpeg]);
  await add({ email: 'b@example.com', business: 'Beta Roofing' }, []);
  return { store, execute: createWorkspaceService({ waitlist: store }) };
}

test('tools are registered, unique and the update is a write', () => {
  const names = WORKSPACE_TOOLS.map(([name]) => name);
  for (const name of ['list_nexus_waitlist', 'read_nexus_waitlist_entry', 'update_nexus_waitlist_entry']) assert.ok(names.includes(name), name);
  for (const action of ['waitlist', 'waitlist_entry', 'update_waitlist_entry']) assert.ok(WORKSPACE_ACTIONS[action], action);
  assert.ok(WORKSPACE_WRITES.has('update_waitlist_entry'));
  assert.equal(WORKSPACE_WRITES.has('waitlist'), false);
});

test('owner lists newest first with status counts', async () => {
  const { execute } = await setup();
  const r = await execute('waitlist', {}, owner);
  assert.equal(r.total, 2);
  assert.equal(r.entries[0].business, 'Beta Roofing');
  assert.equal(r.counts.waiting, 2);
  assert.equal(r.entries[1].photos, 1);
  assert.equal(r.entries[1].has_extra_notes, true);
  assert.equal((await execute('waitlist', { status: 'paid' }, owner)).shown, 0);
});

test('owner reads one entry with its photo as an inline image', async () => {
  const { execute } = await setup();
  const r = await execute('waitlist_entry', { entry_id: 'aaaaaaaa-1' }, owner);
  assert.equal(r.entry.business, 'Alpha Lawn');
  assert.equal(r.entry.email, 'a@example.com');
  assert.equal(r.inline_images.length, 1);
  assert.equal(r.inline_images[0].mime, 'image/jpeg');
  assert.equal(r.inline_images[0].data_base64, jpeg.split(',')[1]);
  await assert.rejects(() => execute('waitlist_entry', { entry_id: 'aaaaaaaa-99' }, owner), /No waitlist entry/);
});

test('owner updates status and note; bad input is rejected', async () => {
  const { execute } = await setup();
  const r = await execute('update_waitlist_entry', { entry_id: 'aaaaaaaa-2', status: 'previewing', note: 'building now' }, owner);
  assert.deepEqual(r, { entry_id: 'aaaaaaaa-2', status: 'previewing', note: 'building now' });
  const list = await execute('waitlist', { status: 'previewing' }, owner);
  assert.equal(list.shown, 1); assert.equal(list.entries[0].note, 'building now');
  await assert.rejects(() => execute('update_waitlist_entry', { entry_id: 'aaaaaaaa-2', status: 'bogus' }, owner), /Status must be/);
  await assert.rejects(() => execute('update_waitlist_entry', { entry_id: 'aaaaaaaa-2' }, owner), /status, a note/);
  await assert.rejects(() => execute('update_waitlist_entry', { entry_id: 'aaaaaaaa-2', note: 'x'.repeat(501) }, owner), /500/);
  await assert.rejects(() => execute('update_waitlist_entry', { entry_id: 'nope-nope-1', status: 'paid' }, owner), /No waitlist entry/);
});

test('customer accounts can never use the waitlist actions', async () => {
  const { execute } = await setup();
  for (const [action, input] of [['waitlist', {}], ['waitlist_entry', { entry_id: 'aaaaaaaa-1' }], ['update_waitlist_entry', { entry_id: 'aaaaaaaa-1', status: 'paid' }]]) {
    await assert.rejects(() => execute(action, input, customer), /owner/i, action);
  }
});

test('customer connection hides the owner-only tools', () => {
  const src = readFileSync(new URL('../api/customer-board-mcp.js', import.meta.url), 'utf8');
  assert.match(src, /CUSTOMER_HIDDEN_TOOLS=new Set\(\[[^\]]*list_nexus_waitlist[^\]]*read_nexus_waitlist_entry[^\]]*update_nexus_waitlist_entry/);
  assert.match(src, /CUSTOMER_HIDDEN_TOOLS\.has\(name\)\?undefined:/);
  assert.match(src, /CUSTOMER_HIDDEN_TOOLS=new Set\(\[[^\]]*import_nexus_waitlist_photos/);
});

import { createAdImageStore } from '../lib/adImages.js';

function hashRedis() {
  const h = new Map();
  return async (p) => {
    const [c, k, f, v] = p; const m = h.get(k) || new Map(); h.set(k, m);
    if (c === 'HVALS') return [...m.values()];
    if (c === 'HLEN') return m.size;
    if (c === 'HSET') { m.set(f, v); return 1; }
    if (c === 'HGET') return m.has(f) ? m.get(f) : null;
    if (c === 'HDEL') return m.delete(f) ? 1 : 0;
    throw new Error('unexpected ' + c);
  };
}

test('import_waitlist_photos copies photos into the image library, once, owner only', async () => {
  const { store } = await setup();
  const images = createAdImageStore({ command: hashRedis() });
  const execute = createWorkspaceService({ waitlist: store, images });
  assert.ok(WORKSPACE_ACTIONS.import_waitlist_photos);
  assert.ok(WORKSPACE_WRITES.has('import_waitlist_photos'));
  assert.ok(WORKSPACE_TOOLS.some(([n]) => n === 'import_nexus_waitlist_photos'));
  const r = await execute('import_waitlist_photos', { entry_id: 'aaaaaaaa-1' }, owner);
  assert.equal(r.saved.length, 1); assert.equal(r.saved[0].name, 'Alpha Lawn photo 1');
  const again = await execute('import_waitlist_photos', { entry_id: 'aaaaaaaa-1' }, owner);
  assert.equal(again.saved.length, 0); assert.equal(again.skipped[0].reason, 'already imported');
  assert.equal((await execute('import_waitlist_photos', { entry_id: 'aaaaaaaa-2' }, owner)).saved.length, 0);
  assert.equal((await execute('images', {}, owner)).images.length, 1);
  await assert.rejects(() => execute('import_waitlist_photos', { entry_id: 'aaaaaaaa-1' }, customer), /owner/i);
  await assert.rejects(() => execute('import_waitlist_photos', { entry_id: 'nope-nope-1' }, owner), /owner|No waitlist entry/);
});
