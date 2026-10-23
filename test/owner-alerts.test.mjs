import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAlertStore, ALERT_KINDS } from '../lib/ownerAlerts.js';
import { waitlistAlerts, sweepWaitlistAlerts } from '../lib/waitlistAlerts.js';
import { createAlertsHandler } from '../lib/alertsApi.js';
import { createWaitlistStore } from '../lib/waitlist.js';
import { handleWaitlist } from '../api/waitlist.js';
import { createWorkspaceService } from '../lib/workspaceConnector.js';
import { relativeTime } from '../public/alerts-bell.js';

function fakeRedis() {
  const kv = new Map(); const lists = new Map();
  return async (p) => {
    const [c, k, a, b] = p;
    if (c === 'SET') { if (p.includes('NX') && kv.has(k)) return null; kv.set(k, a); return 'OK'; }
    if (c === 'GET') return kv.has(k) ? kv.get(k) : null;
    if (c === 'DEL') { kv.delete(k); return 1; }
    if (c === 'LPUSH') { const l = lists.get(k) || []; l.unshift(a); lists.set(k, l); return l.length; }
    if (c === 'LTRIM') { lists.set(k, (lists.get(k) || []).slice(Number(a), Number(b) + 1)); return 'OK'; }
    if (c === 'RPUSH') { const l = lists.get(k) || []; l.push(a); lists.set(k, l); return l.length; }
    if (c === 'LRANGE') return (lists.get(k) || []).slice(Number(a), Number(b) + 1);
    if (c === 'LSET') { lists.get(k)[Number(a)] = b; return 'OK'; }
    if (c === 'LLEN') return (lists.get(k) || []).length;
    throw new Error('unexpected ' + c);
  };
}
const mockRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.sent = b; return r; } }; return r; };
const entry = { name: 'Sam', business: 'Sam Lawn Care', kind: 'website', what: 'A simple site with my services', extra: '', links: '', email: 'sam@example.com', phone: '', consent: true };

function env() {
  const command = fakeRedis(); let t = 1_000_000;
  const clock = { now: () => t, tick: (ms) => { t += ms; } };
  const alertsStore = createAlertStore({ command, now: clock.now });
  const waitlist = createWaitlistStore({ command, now: clock.now });
  const deps = { store: alertsStore };
  return { command, clock, alertsStore, waitlist, deps };
}

test('store keeps newest first, counts unread, and mark-read clears the count', async () => {
  const { alertsStore, clock } = env();
  await alertsStore.push({ kind: 'new_request', title: 'First' }); clock.tick(1000);
  await alertsStore.push({ kind: 'paid', title: 'Second', body: 'x' }); clock.tick(1000);
  let r = await alertsStore.list();
  assert.deepEqual(r.items.map((a) => a.title), ['Second', 'First']);
  assert.equal(r.unread, 2);
  await alertsStore.markRead(); clock.tick(1000);
  r = await alertsStore.list();
  assert.equal(r.unread, 0);
  await alertsStore.push({ kind: 'problem', title: 'Third' });
  r = await alertsStore.list();
  assert.equal(r.unread, 1);
  assert.equal(r.items[0].unread, true);
  assert.equal(r.items[2].unread, false);
});

test('store dedupes by key, validates kind and title, cleans text and urls', async () => {
  const { alertsStore } = env();
  assert.equal((await alertsStore.push({ kind: 'new_request', title: 'A', key: 'k1' })).added, true);
  assert.equal((await alertsStore.push({ kind: 'new_request', title: 'A', key: 'k1' })).added, false);
  await assert.rejects(alertsStore.push({ kind: 'nope', title: 'A' }));
  await assert.rejects(alertsStore.push({ kind: 'paid', title: '   ' }));
  await alertsStore.push({ kind: 'problem', title: 'T\n\u0000x'.repeat(100), body: 'b'.repeat(999), url: 'javascript:alert(1)' });
  await alertsStore.push({ kind: 'problem', title: 'proto', url: '//evil.example/x' });
  await alertsStore.push({ kind: 'problem', title: 'ok-path', url: '/p/abc' });
  await alertsStore.push({ kind: 'problem', title: 'ok-https', url: 'https://claude.ai/x' });
  const { items } = await alertsStore.list(50);
  const by = Object.fromEntries(items.map((a) => [a.title.slice(0, 8), a]));
  assert.ok(items.find((a) => a.title.length <= 120));
  assert.equal(items.find((a) => a.body.length === 240).url, '');
  assert.equal(by['proto'].url, '');
  assert.equal(by['ok-path'].url, '/p/abc');
  assert.equal(by['ok-https'].url, 'https://claude.ai/x');
  assert.ok(ALERT_KINDS.includes('preview_viewed'));
});

test('a failing store never breaks the caller', async () => {
  const bad = { push: async () => { throw new Error('redis down'); } };
  assert.deepEqual(await waitlistAlerts.newRequest({ ...entry, id: 'abc12345' }, 'abc12345', { store: bad }), { added: false });
});

test('API: owner only, lists, marks read, sweep needs the cron secret', async () => {
  const { alertsStore } = env();
  await alertsStore.push({ kind: 'paid', title: 'Paid: Sam' });
  const asOwner = createAlertsHandler({ getOwner: async () => ({ id: 'j' }), store: alertsStore, sweep: async () => ({ checked: 0, alerted: 0 }), authorized: () => false });
  const anon = createAlertsHandler({ getOwner: async () => null, store: alertsStore, authorized: () => false });
  const denied = mockRes(); await anon({ method: 'GET', url: '/api/alerts', headers: {} }, denied);
  assert.equal(denied.code, 401);
  const list = mockRes(); await asOwner({ method: 'GET', url: '/api/alerts', headers: {} }, list);
  assert.equal(list.body.unread, 1); assert.equal(list.body.items[0].title, 'Paid: Sam');
  const read = mockRes(); await asOwner({ method: 'POST', url: '/api/alerts', headers: {}, body: { action: 'read' } }, read);
  assert.equal(read.body.unread, 0);
  const bad = mockRes(); await asOwner({ method: 'POST', url: '/api/alerts', headers: {}, body: { action: 'wipe' } }, bad);
  assert.equal(bad.code, 400);
  const noCron = mockRes(); await asOwner({ method: 'GET', url: '/api/alerts?sweep=1', headers: {} }, noCron);
  assert.equal(noCron.code, 401);
  const cron = createAlertsHandler({ getOwner: async () => null, store: alertsStore, sweep: async () => ({ checked: 3, alerted: 1 }), authorized: () => true });
  const ok = mockRes(); await cron({ method: 'GET', url: '/api/alerts?sweep=1', headers: {} }, ok);
  assert.deepEqual(ok.body, { checked: 3, alerted: 1 });
});

test('signup rings the bell; if the builder was not started it also flags the problem', async () => {
  const { waitlist, alertsStore, deps } = env();
  const alerts = { newRequest: (e, id) => waitlistAlerts.newRequest(e, id, deps), builderNotStarted: (e, id, r) => waitlistAlerts.builderNotStarted(e, id, r, deps) };
  const res = mockRes();
  await handleWaitlist({ method: 'POST', body: entry, headers: {} }, res, { store: waitlist, allow: async () => true, alerts, wake: async () => ({ woke: false, reason: 'daily cap' }) });
  assert.equal(res.code, 200);
  const { items } = await alertsStore.list();
  assert.deepEqual(items.map((a) => a.kind).sort(), ['new_request', 'problem']);
  assert.match(items.find((a) => a.kind === 'problem').body, /daily build limit/);
  assert.match(items.find((a) => a.kind === 'new_request').title, /Sam Lawn Care/);
});

test('a duplicate signup does not ring the bell again; a good wake raises no problem alert', async () => {
  const { waitlist, alertsStore, deps } = env();
  const alerts = { newRequest: (e, id) => waitlistAlerts.newRequest(e, id, deps), builderNotStarted: (e, id, r) => waitlistAlerts.builderNotStarted(e, id, r, deps) };
  const d = { store: waitlist, allow: async () => true, alerts, wake: async () => ({ woke: true }) };
  await handleWaitlist({ method: 'POST', body: entry, headers: {} }, mockRes(), d);
  await handleWaitlist({ method: 'POST', body: entry, headers: {} }, mockRes(), d);
  const { items } = await alertsStore.list();
  assert.deepEqual(items.map((a) => a.kind), ['new_request']);
});

test('first open of a preview rings the bell once, but not for the owner', async () => {
  const { waitlist, alertsStore, deps } = env();
  const { id } = await waitlist.add(entry, []);
  await waitlist.savePreview(id, '<p>hi</p>'); await waitlist.update(id, { status: 'preview_sent' });
  const alerts = { previewViewed: (e, i, u) => waitlistAlerts.previewViewed(e, i, u, deps) };
  const owner = mockRes();
  await handleWaitlist({ method: 'GET', query: { preview: id }, headers: {} }, owner, { store: waitlist, alerts, isOwner: async () => true });
  assert.equal(owner.code, 200); assert.equal((await alertsStore.list()).items.length, 0);
  for (let i = 0; i < 3; i++) await handleWaitlist({ method: 'GET', query: { preview: id }, headers: {} }, mockRes(), { store: waitlist, alerts, isOwner: async () => false });
  const { items } = await alertsStore.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'preview_viewed'); assert.equal(items[0].url, '/p/' + id);
});

const account = { id: 'acct', owner: true, workbenchUserId: 'w', scheduleUserId: 'owner:j' };

test('saving a preview rings the bell and adds a next-day follow-up reminder', async () => {
  const { waitlist, alertsStore, deps, clock } = env();
  const { id } = await waitlist.add(entry, []);
  const made = [];
  const reminders = { create: async (input, user) => { made.push({ input, user }); return { id: 'r1' }; } };
  const alerts = { previewReady: (e, i, u) => waitlistAlerts.previewReady(e, i, u, deps) };
  const execute = createWorkspaceService({ waitlist, alerts, reminders, now: clock.now });
  await execute('save_waitlist_preview', { entry_id: id, html: '<p>Concept preview</p>' }, account);
  const { items } = await alertsStore.list();
  assert.equal(items[0].kind, 'preview_ready'); assert.equal(items[0].url, '/p/' + id);
  assert.equal(made.length, 1);
  assert.equal(made[0].user, 'owner:j');
  assert.match(made[0].input.title, /Follow up with Sam Lawn Care/);
  assert.equal(made[0].input.due_date, new Date(clock.now() + 86400000).toISOString().slice(0, 10));
});

test('a failing reminder or alert never stops the preview from saving', async () => {
  const { waitlist } = env();
  const { id } = await waitlist.add(entry, []);
  const execute = createWorkspaceService({ waitlist, alerts: { previewReady: async () => { throw new Error('x'); } }, reminders: { create: async () => { throw new Error('y'); } } });
  const out = await execute('save_waitlist_preview', { entry_id: id, html: '<p>ok</p>' }, account);
  assert.equal(out.status, 'preview_sent');
});

test('marking paid or live, or a builder note while previewing, rings the bell', async () => {
  const { waitlist, alertsStore, deps } = env();
  const { id } = await waitlist.add(entry, []);
  const alerts = { statusChanged: (e, s) => waitlistAlerts.statusChanged(e, s, deps), builderNote: (e, n) => waitlistAlerts.builderNote(e, n, deps) };
  const execute = createWorkspaceService({ waitlist, alerts });
  await execute('update_waitlist_entry', { entry_id: id, status: 'previewing' }, account);
  assert.equal((await alertsStore.list()).items.length, 0);
  await execute('update_waitlist_entry', { entry_id: id, note: 'Could not read their photos' }, account);
  await execute('update_waitlist_entry', { entry_id: id, status: 'paid' }, account);
  await execute('update_waitlist_entry', { entry_id: id, status: 'paid' }, account);
  const kinds = (await alertsStore.list()).items.map((a) => a.kind).sort();
  assert.deepEqual(kinds, ['paid', 'problem']);
});

test('sweep flags requests nobody started and builds that look stuck, once each', async () => {
  const { waitlist, alertsStore, deps, clock } = env();
  const a = await waitlist.add(entry, []);
  const b = await waitlist.add({ ...entry, email: 'b@example.com', business: 'B Co' }, []);
  await waitlist.update(b.id, { status: 'previewing' });
  const sweep = () => sweepWaitlistAlerts({ store: waitlist, now: clock.now, deps });
  assert.deepEqual(await sweep(), { checked: 2, alerted: 0 });
  clock.tick(6 * 60 * 1000);
  assert.equal((await sweep()).alerted, 1);
  clock.tick(7 * 60 * 1000);
  assert.equal((await sweep()).alerted, 1);
  assert.equal((await sweep()).alerted, 0);
  const kinds = (await alertsStore.list()).items.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['problem', 'stuck']);
  assert.ok(a.id && b.id);
});

test('bell UI: relative times, textContent only, mounted in the workspace, route and cron wired', () => {
  assert.equal(relativeTime(1000, 1000), 'just now');
  assert.equal(relativeTime(0, 5 * 60 * 1000), '5m ago');
  assert.equal(relativeTime(0, 3 * 3600 * 1000), '3h ago');
  assert.equal(relativeTime(0, 2 * 86400 * 1000), '2d ago');
  const ui = fs.readFileSync(new URL('../public/alerts-bell.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(ui), 'alert text must never be inserted as HTML');
  assert.match(fs.readFileSync(new URL('../public/workspace.html', import.meta.url), 'utf8'), /import '\/alerts-bell\.js'/);
  const cfg = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(cfg.rewrites.some((r) => r.source === '/api/alerts' && r.destination === '/api/board'));
  assert.ok(cfg.crons.some((c) => c.path === '/api/alerts?sweep=1'));
});
