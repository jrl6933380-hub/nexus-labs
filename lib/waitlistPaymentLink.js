// Stripe payment links for taking a waitlist preview live. The entry id rides along as client_reference_id,
// so when the visitor pays, the webhook knows which entry it was. The links are public (they are meant to be
// sent to visitors), so they can live in code; each can be overridden with an env var if a link changes.
//
// Offers by kind of request:
//   site   (website, both, other, older ai_helper)  $9 to go live, then $9/month (price from WAITLIST_PRICE_USD)
//   agent  (their own AI agent)                     $20 once. Off until WAITLIST_AGENT_PAYMENTS=on (hosting is not built yet)
//   app    (an app for me)                          $20 once
//   app_ai (an app with AI built in)                $40 once ($20 plus $20 for the AI)
import { waitlistPrice } from './waitlist.js';

const ID_RE = /^[0-9a-f-]{36}$/i;
export const ACTIVATION_PRICES = { agent: 20, app: 20, app_ai: 40 };

const LINKS = {
  site: { url: 'https://buy.stripe.com/00w6oH15NaHj9pf2mR4Ja02', env: 'WAITLIST_PAYMENT_LINK' },
  agent: { url: 'https://buy.stripe.com/6oU9AT15N5mZ1WN0eJ4Ja06', env: 'WAITLIST_PAYMENT_LINK_AGENT' },
  app: { url: 'https://buy.stripe.com/00w00j3dVaHj1WN7Hb4Ja04', env: 'WAITLIST_PAYMENT_LINK_APP' },
  app_ai: { url: 'https://buy.stripe.com/7sY4gzdSz02F6d3aTn4Ja07', env: 'WAITLIST_PAYMENT_LINK_APP_AI' },
};

// Which offer an entry gets. With no entry (older callers) it is the website offer.
export function offerTier(entry) {
  const kind = entry?.kind;
  if (kind === 'agent') return 'agent';
  if (kind === 'tool') return /wants ai built in/i.test(String(entry?.extra || '')) ? 'app_ai' : 'app';
  return 'site';
}

export function waitlistPaymentLink(entryId, env = process.env, entry = null) {
  if (!ID_RE.test(String(entryId))) return '';
  const tier = offerTier(entry);
  if (tier === 'agent' && String(env.WAITLIST_AGENT_PAYMENTS || '').toLowerCase() !== 'on') return '';
  const spec = LINKS[tier];
  let base;
  try {
    const u = new URL(env[spec.env] || spec.url);
    if (u.protocol !== 'https:' || u.hostname !== 'buy.stripe.com') return '';
    base = u;
  } catch { return ''; }
  base.searchParams.set('client_reference_id', String(entryId));
  return base.href;
}

// Plain-language offer shown to the visitor next to the pay button.
export function waitlistOffer(entry, env = process.env) {
  const tier = offerTier(entry);
  if (tier === 'agent') return { tier, noun: 'agent', cta: 'Activate my agent', text: `activating it is $${ACTIVATION_PRICES.agent}, one time.`, after: '' };
  if (tier === 'app') return { tier, noun: 'app', cta: 'Activate my app', text: `activating it is $${ACTIVATION_PRICES.app}, one time.`, after: '' };
  if (tier === 'app_ai') return { tier, noun: 'app', cta: 'Activate my app', text: `activating it is $${ACTIVATION_PRICES.app_ai}, one time, with AI built in.`, after: '' };
  const p = waitlistPrice(env);
  return { tier, noun: 'site', cta: 'Take it live', text: `going live is $${p}, then $${p}/month.`, after: `$${p}/month covers hosting and reasonable edits.` };
}
