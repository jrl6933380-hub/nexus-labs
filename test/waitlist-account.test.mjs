import test from 'node:test';
import assert from 'node:assert/strict';
import { signEntryToken, verifyEntryToken, accountView, validSiteUrl } from '../lib/waitlistAccount.js';
import { handleWaitlist } from '../api/waitlist.js';
import { markWaitlistPaid } from '../lib/waitlistPayments.js';
import { publicBuildStatus } from '../lib/waitlistBuilderWake.js';
import { validateWaitlistEntry, createWaitlistStore } from '../lib/waitlist.js';

const ID = '11111111-2222-3333-4444-555555555555';
const env = { WAITLIST_TOKEN_SECRET: 'test-secret' };
const mockRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.sent = b; return r; } }; return r; };
const fakeStore = (entry) => { const e = { ...entry }; return { get: async (id) => (id === e.id ? { ...e } : null), update: async (id, p) => { if (id !== e.id) return null; Object.assign(e, p.status ? { status: p.status } : {}); return { ...e }; } }; };

test('token round trip, tamper, wrong secret, missing secret', () => {
  const t = signEntryToken(ID, env);
  assert.equal(verifyEntryToken(t, env), ID);
  assert.equal(verifyEntryToken(t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a'), env), null);
  assert.equal(verifyEntryToken(t, { WAITLIST_TOKEN_SECRET: 'other' }), null);
  assert.equal(verifyEntryToken(ID, env), null);
  assert.equal(verifyEntryToken('', env), null);
  assert.equal(signEntryToken(ID, {}), '');
  assert.equal(signEntryToken('not-an-id', env), '');
  assert.equal(verifyEntryToken(t, {}), null);
});

test('falls back to the Stripe webhook secret when no token secret is set', () => {
  const t = signEntryToken(ID, { STRIPE_WEBHOOK_SECRET: 'whsec' });
  assert.equal(verifyEntryToken(t, { STRIPE_WEBHOOK_SECRET: 'whsec' }), ID);
});

test('accountView maps stages and only shows the site once live', () => {
  assert.equal(accountView({ id: ID, status: 'waiting' }).stage, 'queued');
  assert.equal(accountView({ id: ID, status: 'previewing' }).stage, 'building');
  const prev = accountView({ id: ID, status: 'preview_sent', site_url: 'https://x.example.com' });
  assert.equal(prev.stage, 'preview'); assert.equal(prev.preview_url, `/p/${ID}`); assert.equal(prev.site_url, undefined);
  assert.equal(accountView({ id: ID, status: 'paid', site_url: 'https://x.example.com' }).site_url, undefined);
  const live = accountView({ id: ID, status: 'live', business: 'Sam', site_url: 'https://sam.example.com/' });
  assert.equal(live.stage, 'live'); assert.equal(live.site_url, 'https://sam.example.com/');
  assert.equal(accountView({ id: ID, status: 'live', email: 'a@b.co', note: 'secret' }).email, undefined);
  assert.equal(accountView(null), null);
});

test('validSiteUrl accepts only clean https addresses', () => {
  assert.equal(validSiteUrl('https://sam.example.com'), 'https://sam.example.com/');
  for (const bad of ['http://sam.example.com', 'javascript:alert(1)', 'https://u:p@sam.example.com', 'https://localhost', 'nope', '']) assert.equal(validSiteUrl(bad), '');
});

test('GET ?me: needs a valid token, returns only the customer view', async () => {
  process.env.WAITLIST_TOKEN_SECRET = 'test-secret';
  const store = fakeStore({ id: ID, status: 'live', business: 'Sam Lawn', email: 'sam@example.com', site_url: 'https://sam.example.com' });
  let res = mockRes(); await handleWaitlist({ method: 'GET', query: { me: '1' }, headers: {} }, res, { store });
  assert.equal(res.code, 401);
  res = mockRes(); await handleWaitlist({ method: 'GET', query: { me: '1' }, headers: { 'x-waitlist-token': ID + '.bad' } }, res, { store });
  assert.equal(res.code, 401);
  res = mockRes(); await handleWaitlist({ method: 'GET', query: { me: '1' }, headers: { 'x-waitlist-token': signEntryToken(ID) } }, res, { store });
  assert.equal(res.code, 200); assert.equal(res.body.stage, 'live'); assert.equal(res.body.site_url, 'https://sam.example.com');
  assert.equal(JSON.stringify(res.body).includes('sam@example.com'), false);
});

test('GET ?claim: verifies the Stripe session, marks paid, returns a token', async () => {
  process.env.WAITLIST_TOKEN_SECRET = 'test-secret';
  const store = fakeStore({ id: ID, status: 'preview_sent', business: 'Sam' });
  const good = { metadata: { kind: 'waitlist' }, payment_status: 'paid', client_reference_id: ID };
  const SID = 'cs_live_a1b2c3d4e5f6g7h8i9j0';
  const markPaid = async (s) => { await store.update(s.client_reference_id, { status: 'paid' }); };
  let res = mockRes(); await handleWaitlist({ method: 'GET', query: { claim: SID }, headers: {} }, res, { store, getSession: async () => good, markPaid });
  assert.equal(res.code, 200); assert.equal(res.body.stage, 'setup'); assert.equal(verifyEntryToken(res.body.token), ID);
  for (const bad of [{ ...good, payment_status: 'unpaid' }, { ...good, metadata: {} }, { ...good, client_reference_id: 'nope' }, null]) {
    res = mockRes(); await handleWaitlist({ method: 'GET', query: { claim: SID }, headers: {} }, res, { store, getSession: async () => bad, markPaid });
    assert.equal(res.code, 404);
  }
  res = mockRes(); await handleWaitlist({ method: 'GET', query: { claim: 'cs_x' }, headers: {} }, res, { store, getSession: async () => good, markPaid });
  assert.equal(res.code, 404);
});

test('submit returns a token so the browser can come back later', async () => {
  process.env.WAITLIST_TOKEN_SECRET = 'test-secret';
  const store = { add: async () => ({ duplicate: false, id: ID }) };
  const res = mockRes();
  await handleWaitlist({ method: 'POST', body: { business: 'Sam', what: 'A simple site with my services', email: 'sam@example.com', consent: true }, headers: {} }, res,
    { store, allow: async () => true, wake: async () => ({ woke: true }), alerts: { newRequest: async () => {}, builderNotStarted: async () => {} } });
  assert.equal(res.body.building, true); assert.equal(verifyEntryToken(res.body.token), ID);
});

test('paying sends the confirmation once and never blocks on email failure', async () => {
  const rows = { [ID]: { id: ID, status: 'preview_sent', email: 'sam@example.com' } };
  const store = { get: async (id) => rows[id] || null, update: async (id, p) => (rows[id] = { ...rows[id], ...p }) };
  let sent = 0;
  const alerts = { statusChanged: async () => {} };
  await markWaitlistPaid({ client_reference_id: ID }, { store, alerts, sendConfirmation: async () => { sent++; } });
  assert.equal(rows[ID].status, 'paid'); assert.equal(sent, 1);
  await markWaitlistPaid({ client_reference_id: ID }, { store, alerts, sendConfirmation: async () => { sent++; } }); // Stripe retry
  assert.equal(sent, 1);
  rows[ID].status = 'preview_sent';
  const r = await markWaitlistPaid({ client_reference_id: ID }, { store, alerts, sendConfirmation: async () => { throw new Error('domain not verified'); } });
  assert.equal(r.handled, true);
});

test('loading screen gets a pay link only until they have paid', () => {
  const opts = { allowedHosts: [], payUrl: 'https://buy.stripe.com/x?client_reference_id=' + ID };
  assert.equal(publicBuildStatus({ id: ID, status: 'preview_sent', note: '' }, opts).pay_url, opts.payUrl);
  assert.equal(publicBuildStatus({ id: ID, status: 'paid', note: '' }, opts).pay_url, undefined);
  assert.equal(publicBuildStatus({ id: ID, status: 'paid', note: '' }, opts).paid, true);
  assert.equal(publicBuildStatus({ id: ID, status: 'waiting' }, opts).pay_url, undefined);
});

test('form picks: tools are filtered to the plain list and deduped; store stamps paid/live and site url', async () => {
  const r = validateWaitlistEntry({ what: 'A site with booking for my gym', email: 'a@b.co', consent: true, tools: ['calendar', 'calendar', 'hack', 'chat'] });
  assert.deepEqual(r.entry.tools, ['calendar', 'chat']);
  assert.deepEqual(validateWaitlistEntry({ what: 'A site with booking for my gym', email: 'a@b.co', consent: true }).entry.tools, []);
  const lists = new Map();
  const command = async (p) => { const [c, k, a, b] = p; if (c === 'SET') return 'OK'; if (c === 'RPUSH') { const l = lists.get(k) || []; l.push(a); lists.set(k, l); return l.length; } if (c === 'LRANGE') return (lists.get(k) || []).slice(Number(a), Number(b) + 1); if (c === 'LSET') { lists.get(k)[Number(a)] = b; return 'OK'; } throw new Error(c); };
  const store = createWaitlistStore({ command, now: () => 7, id: () => ID });
  await store.add(r.entry, []);
  const live = await store.update(ID, { status: 'live', siteUrl: 'https://gym.example.com/' });
  assert.equal(live.site_url, 'https://gym.example.com/'); assert.equal(live.live_at, 7);
});
