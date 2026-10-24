// A visitor paid the "go live" payment link. The Stripe webhook calls this with the completed Checkout Session.
// - Matches the entry by client_reference_id (set by waitlistPaymentLink).
// - Only moves the entry forward (never back from live) and is safe to run twice (Stripe retries).
// - Leaves the note alone: the visitor's loading screen reads the preview link from it.
import { waitlistStore } from './waitlist.js';
import { waitlistAlerts } from './waitlistAlerts.js';
import { signEntryToken } from './waitlistAccount.js';

const ID_RE = /^[0-9a-f-]{36}$/i;

const ORIGIN = () => process.env.WAITLIST_PUBLIC_ORIGIN || 'https://nexus-labs-sigma.vercel.app';

// Confirmation email with a one-tap link back to their page. Best effort: until a sending domain is verified in
// Resend it can only reach the account owner, so a failure here must never block marking the entry paid.
async function defaultSendConfirmation(entry) {
  if (!entry.email || !process.env.RESEND_API_KEY || !process.env.WAITLIST_EMAIL_FROM) return { sent: false };
  const token = signEntryToken(entry.id);
  if (!token) return { sent: false };
  const { sendEmail } = await import('./emailSender.js');
  const link = `${ORIGIN()}/welcome.html?t=${encodeURIComponent(token)}`;
  const who = String(entry.business || entry.name || 'your site').replace(/[<>&]/g, '');
  await sendEmail({ to: entry.email, subject: `You're in. We're setting up ${who}`, html: `<p>Thanks, your payment went through.</p><p>We're setting up <b>${who}</b> now. Use this link any time to check progress and open your site when it's live:</p><p><a href="${link}">${link}</a></p><p>Keep this email. The link signs you back in on any device.</p>` });
  return { sent: true };
}

export async function markWaitlistPaid(session, { store = waitlistStore, alerts = waitlistAlerts, sendConfirmation = defaultSendConfirmation } = {}) {
  const id = String(session?.client_reference_id || '');
  if (!ID_RE.test(id)) return { handled: false, reason: 'no entry id' };
  const entry = await store.get(id);
  if (!entry) return { handled: false, reason: 'unknown entry' };
  if (entry.status === 'paid' || entry.status === 'live') return { handled: true, already: true };
  const next = await store.update(id, { status: 'paid' });
  if (!next) return { handled: false, reason: 'unknown entry' };
  await alerts.statusChanged(next, 'paid').catch(() => {});
  await sendConfirmation(next).catch(() => {});
  return { handled: true, entryId: id };
}
