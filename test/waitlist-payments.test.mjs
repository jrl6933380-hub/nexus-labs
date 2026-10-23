import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { waitlistPaymentLink } from '../lib/waitlistPaymentLink.js';
import { markWaitlistPaid } from '../lib/waitlistPayments.js';
import { waitlistAlerts } from '../lib/waitlistAlerts.js';
import { createAlertStore } from '../lib/ownerAlerts.js';
import { createWaitlistStore } from '../lib/waitlist.js';

function fakeRedis() {
  const kv = new Map(); const lists = new Map();
  return async (p) => {
    const [c, k, a, b] = p;
    if (c === 'SET') { if (p.includes('NX') && kv.has(k)) return null; kv.set(k, a); return 'OK'; }
    if (c === 'GET') return kv.has(k) ? kv.get(k) : null;
    if (c === 'LPUSH') { const l = lists.get(k) || []; l.unshift(a); lists.set(k, l); return l.length; }
    if (c === 'LTRIM') { lists.set(k, (lists.get(k) || []).slice(Number(a), Number(b) + 1)); return 'OK'; }
    if (c === 'RPUSH') { const l = lists.get(k) || []; l.push(a); lists.set(k, l); return l.length; }
    if (c === 'LRANGE') return (lists.get(k) || []).slice(Number(a), Number(b) + 1);
    if (c === 'LSET') { lists.get(k)[Number(a)] = b; return 'OK'; }
    throw new Error('unexpected ' + c);
  };
}
const entry = { name: 'Sam', business: 'Sam Lawn Care', kind: 'website', what: 'A simple site', extra: '', links: '', email: 'sam@example.com', phone: '', consent: true };
const ID = '123e4567-e89b-12d3-a456-426614174000';

function setup() {
  const command = fakeRedis();
  const store = createWaitlistStore({ command });
  const alertStore = createAlertStore({ command });
  const alerts = { statusChanged: (e, s) => waitlistAlerts.statusChanged(e, s, { store: alertStore }) };
  return { store, alertStore, alerts };
}

test('payment link carries the entry id and only ever points at Stripe over https', () => {
  const url = new URL(waitlistPaymentLink(ID, {}));
  assert.equal(url.hostname, 'buy.stripe.com');
  assert.equal(url.searchParams.get('client_reference_id'), ID);
  assert.equal(waitlistPaymentLink('nope', {}), '');
  assert.equal(waitlistPaymentLink(ID, { WAITLIST_PAYMENT_LINK: 'https://evil.example/x' }), '');
  assert.equal(waitlistPaymentLink(ID, { WAITLIST_PAYMENT_LINK: 'http://buy.stripe.com/x' }), '');
  assert.match(waitlistPaymentLink(ID, { WAITLIST_PAYMENT_LINK: 'https://buy.stripe.com/abc' }), /^https:\/\/buy\.stripe\.com\/abc\?client_reference_id=/);
});

test('a paid session marks the entry paid, keeps the preview link, and rings the bell once', async () => {
  const { store, alertStore, alerts } = setup();
  const { id } = await store.add(entry, []);
  await store.update(id, { status: 'preview_sent', note: 'https://site.example/p/' + id });
  const first = await markWaitlistPaid({ client_reference_id: id }, { store, alerts });
  assert.deepEqual(first, { handled: true, entryId: id });
  const saved = await store.get(id);
  assert.equal(saved.status, 'paid');
  assert.equal(saved.note, 'https://site.example/p/' + id, 'the visitor loading screen still needs the preview link');
  const again = await markWaitlistPaid({ client_reference_id: id }, { store, alerts });
  assert.deepEqual(again, { handled: true, already: true });
  const { items } = await alertStore.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'paid');
  assert.match(items[0].title, /Sam Lawn Care/);
});

test('live entries stay live; unknown or missing ids are reported, not guessed', async () => {
  const { store, alerts } = setup();
  const { id } = await store.add(entry, []);
  await store.update(id, { status: 'live' });
  assert.deepEqual(await markWaitlistPaid({ client_reference_id: id }, { store, alerts }), { handled: true, already: true });
  assert.equal((await store.get(id)).status, 'live');
  assert.deepEqual(await markWaitlistPaid({ client_reference_id: ID }, { store, alerts }), { handled: false, reason: 'unknown entry' });
  assert.deepEqual(await markWaitlistPaid({ client_reference_id: 'someusername' }, { store, alerts }), { handled: false, reason: 'no entry id' });
  assert.deepEqual(await markWaitlistPaid({}, { store, alerts }), { handled: false, reason: 'no entry id' });
});

test('a storage failure surfaces so Stripe retries the webhook', async () => {
  const store = { get: async () => { throw new Error('redis down'); } };
  await assert.rejects(markWaitlistPaid({ client_reference_id: ID }, { store, alerts: {} }), /redis down/);
});

test('the preview-ready alert includes the payment link for that entry', async () => {
  const { alertStore } = setup();
  await waitlistAlerts.previewReady({ ...entry, id: ID }, ID, '/p/' + ID, { store: alertStore });
  const { items } = await alertStore.list();
  assert.match(items[0].body, /Payment link/);
  assert.ok(items[0].body.includes('client_reference_id=' + ID));
});

test('webhook routes waitlist checkouts before the Forge and plan handlers and retries on failure', () => {
  const src = fs.readFileSync(new URL('../api/webhooks/stripe.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ markWaitlistPaid \}/);
  const waitlistAt = src.indexOf("forgeObj.metadata?.kind === 'waitlist'");
  assert.ok(waitlistAt > 0);
  assert.ok(waitlistAt < src.indexOf("forgeObj.metadata?.kind === 'forge_client'"));
  assert.ok(waitlistAt < src.indexOf("const username = session.metadata?.username"));
  assert.match(src.slice(waitlistAt, waitlistAt + 900), /status\(500\)/);
});
