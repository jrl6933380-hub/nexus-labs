import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVATION_PRICES, offerTier, waitlistOffer, waitlistPaymentLink } from '../lib/waitlistPaymentLink.js';
import { publicBuildStatus } from '../lib/waitlistBuilderWake.js';
import { waitlistAlerts } from '../lib/waitlistAlerts.js';
import { createAlertStore } from '../lib/ownerAlerts.js';

const ID = '123e4567-e89b-12d3-a456-426614174000';
const link = (entry, env = {}) => waitlistPaymentLink(ID, env, entry);

test('each kind of request gets its own offer tier', () => {
  assert.equal(offerTier({ kind: 'website' }), 'site');
  assert.equal(offerTier({ kind: 'both' }), 'site');
  assert.equal(offerTier({ kind: 'other' }), 'site');
  assert.equal(offerTier({ kind: 'ai_helper' }), 'site');
  assert.equal(offerTier(null), 'site');
  assert.equal(offerTier({ kind: 'agent' }), 'agent');
  assert.equal(offerTier({ kind: 'tool', extra: 'Colors: Red' }), 'app');
  assert.equal(offerTier({ kind: 'tool', extra: 'Wants AI built in. Colors: Red' }), 'app_ai');
});

test('prices: agent $20, app $20, app with AI $40, site from the existing setting', () => {
  assert.deepEqual(ACTIVATION_PRICES, { agent: 20, app: 20, app_ai: 40 });
  assert.match(waitlistOffer({ kind: 'tool', extra: '' }).text, /\$20, one time/);
  assert.match(waitlistOffer({ kind: 'tool', extra: 'Wants AI built in' }).text, /\$40, one time, with AI/);
  assert.match(waitlistOffer({ kind: 'agent' }).text, /\$20, one time/);
  assert.match(waitlistOffer({ kind: 'website' }, { WAITLIST_PRICE_USD: '12' }).text, /\$12, then \$12\/month/);
  assert.equal(waitlistOffer({ kind: 'website' }).cta, 'Take it live');
  assert.equal(waitlistOffer({ kind: 'tool' }).cta, 'Activate my app');
});

test('links carry the entry id, come from Stripe over https, and differ per tier', () => {
  const site = link({ kind: 'website' }), app = link({ kind: 'tool', extra: '' }), appAi = link({ kind: 'tool', extra: 'Wants AI built in' });
  for (const u of [site, app, appAi]) {
    const url = new URL(u);
    assert.equal(url.hostname, 'buy.stripe.com');
    assert.equal(url.searchParams.get('client_reference_id'), ID);
  }
  assert.equal(new Set([site, app, appAi].map((u) => new URL(u).pathname)).size, 3);
  assert.equal(link({ kind: 'website' }, { WAITLIST_PAYMENT_LINK_APP: 'https://evil.example/x' }), site, 'an app override does not touch the site link');
  assert.equal(link({ kind: 'tool' }, { WAITLIST_PAYMENT_LINK_APP: 'https://evil.example/x' }), '');
  assert.equal(waitlistPaymentLink('nope', {}, { kind: 'tool' }), '');
});

test('agent payments stay off until switched on', () => {
  assert.equal(link({ kind: 'agent' }), '');
  assert.equal(link({ kind: 'agent' }, { WAITLIST_AGENT_PAYMENTS: 'off' }), '');
  assert.match(link({ kind: 'agent' }, { WAITLIST_AGENT_PAYMENTS: 'on' }), /^https:\/\/buy\.stripe\.com\/.+client_reference_id=/);
});

test('build status hands the loading page the offer, and the pay link only before they pay', () => {
  const entry = { id: ID, status: 'preview_sent', note: 'https://site.example/p/' + ID };
  const offer = waitlistOffer({ kind: 'tool', extra: '' });
  const view = publicBuildStatus(entry, { allowedHosts: ['site.example'], payUrl: 'https://buy.stripe.com/x', offer });
  assert.equal(view.offer.cta, 'Activate my app');
  assert.equal(view.pay_url, 'https://buy.stripe.com/x');
  const paid = publicBuildStatus({ ...entry, status: 'paid' }, { allowedHosts: ['site.example'], payUrl: 'https://buy.stripe.com/x', offer });
  assert.equal(paid.pay_url, undefined);
  assert.equal(publicBuildStatus({ ...entry, status: 'waiting' }, { offer }).offer, undefined);
});

test('the owner alert shows the right link per kind and says when agent payments are off', async () => {
  const mem = new Map(); const lists = new Map();
  const command = async (p) => {
    const [c, k, a, b] = p;
    if (c === 'SET') { if (p.includes('NX') && mem.has(k)) return null; mem.set(k, a); return 'OK'; }
    if (c === 'GET') return mem.get(k) ?? null;
    if (c === 'LPUSH') { const l = lists.get(k) || []; l.unshift(a); lists.set(k, l); return l.length; }
    if (c === 'LTRIM') { lists.set(k, (lists.get(k) || []).slice(Number(a), Number(b) + 1)); return 'OK'; }
    if (c === 'LRANGE') return (lists.get(k) || []).slice(Number(a), Number(b) + 1);
    throw new Error('unexpected ' + c);
  };
  const store = createAlertStore({ command });
  await waitlistAlerts.previewReady({ id: ID, kind: 'tool', extra: 'Wants AI built in', business: 'AdForge' }, ID, '/p/' + ID, { store });
  await waitlistAlerts.previewReady({ id: ID.replace('4000', '4001'), kind: 'agent', business: 'Gym Buddy' }, ID.replace('4000', '4001'), '/p/x', { store });
  const { items } = await store.list();
  const app = items.find((i) => /AdForge/.test(i.title)), agent = items.find((i) => /Gym Buddy/.test(i.title));
  assert.match(app.body, /Payment link/);
  assert.match(agent.body, /Agent payments are off/);
  assert.doesNotMatch(agent.body, /buy\.stripe\.com/);
});
