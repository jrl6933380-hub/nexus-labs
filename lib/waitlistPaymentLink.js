// The Stripe payment link for taking a waitlist preview live ("Nexus site: go live", monthly).
// The entry id rides along as client_reference_id, so when the visitor pays, the webhook knows which entry it was.
// The link itself is public (it is meant to be sent to visitors), so it can live in code; override with
// WAITLIST_PAYMENT_LINK if the link changes.
const DEFAULT_LINK = 'https://buy.stripe.com/00w6oH15NaHj9pf2mR4Ja02';
const ID_RE = /^[0-9a-f-]{36}$/i;

export function waitlistPaymentLink(entryId, env = process.env) {
  if (!ID_RE.test(String(entryId))) return '';
  let base;
  try { const u = new URL(env.WAITLIST_PAYMENT_LINK || DEFAULT_LINK); if (u.protocol !== 'https:' || u.hostname !== 'buy.stripe.com') return ''; base = u; } catch { return ''; }
  base.searchParams.set('client_reference_id', String(entryId));
  return base.href;
}
