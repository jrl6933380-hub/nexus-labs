// A visitor paid the "go live" payment link. The Stripe webhook calls this with the completed Checkout Session.
// - Matches the entry by client_reference_id (set by waitlistPaymentLink).
// - Only moves the entry forward (never back from live) and is safe to run twice (Stripe retries).
// - Leaves the note alone: the visitor's loading screen reads the preview link from it.
import { waitlistStore } from './waitlist.js';
import { waitlistAlerts } from './waitlistAlerts.js';

const ID_RE = /^[0-9a-f-]{36}$/i;

export async function markWaitlistPaid(session, { store = waitlistStore, alerts = waitlistAlerts } = {}) {
  const id = String(session?.client_reference_id || '');
  if (!ID_RE.test(id)) return { handled: false, reason: 'no entry id' };
  const entry = await store.get(id);
  if (!entry) return { handled: false, reason: 'unknown entry' };
  if (entry.status === 'paid' || entry.status === 'live') return { handled: true, already: true };
  const next = await store.update(id, { status: 'paid' });
  if (!next) return { handled: false, reason: 'unknown entry' };
  await alerts.statusChanged(next, 'paid').catch(() => {});
  return { handled: true, entryId: id };
}
