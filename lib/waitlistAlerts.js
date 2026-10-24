// What the owner's bell says about the waitlist. Wording lives here so the signup form, the builder tools and the
// background sweep all describe events the same way. Everything is best effort and deduped by entry id.
import { notifyOwner } from './ownerAlerts.js';
import { waitlistStore } from './waitlist.js';
import { waitlistPaymentLink } from './waitlistPaymentLink.js';

const label = (e) => String(e?.business || e?.name || 'a visitor').slice(0, 60);
const KIND_LABEL = { website: 'website', ai_helper: 'chat helper', tool: 'tool', both: 'website + chat helper', agent: 'custom AI agent', other: 'something else' };
const WAITING_MS = 5 * 60 * 1000;   // the builder should have started within 5 minutes
const BUILDING_MS = 12 * 60 * 1000; // same limit the visitor's loading screen uses

export const waitlistAlerts = {
  newRequest: (entry, id, deps) => notifyOwner({
    kind: 'new_request', key: `new:${id}`,
    title: `New request: ${label(entry)}`,
    body: `${KIND_LABEL[entry?.kind] || 'project'}: ${entry?.what || ''}`,
  }, deps),
  builderNotStarted: (entry, id, reason, deps) => notifyOwner({
    kind: 'problem', key: `nostart:${id}`,
    title: `Builder was not started for ${label(entry)}`,
    body: reason === 'daily cap' ? 'The daily build limit was reached. Build it by hand or raise the cap.' : `Reason: ${reason || 'not configured'}. The request is saved and waiting.`,
  }, deps),
  previewReady: (entry, id, url, deps) => notifyOwner({
    kind: 'preview_ready', key: `ready:${id}`,
    title: `Preview ready: ${label(entry)}`,
    body: 'Their loading screen now shows the preview button.' + (waitlistPaymentLink(id, process.env, entry) ? ' Payment link for when they say yes: ' + waitlistPaymentLink(id, process.env, entry) : (entry?.kind === 'agent' ? ' Agent payments are off until hosting is ready (WAITLIST_AGENT_PAYMENTS).' : '')), url,
  }, deps),
  previewViewed: (entry, id, url, deps) => notifyOwner({
    kind: 'preview_viewed', key: `viewed:${id}`,
    title: `${label(entry)} opened their preview`,
    body: 'First time the preview link was opened. A good moment to follow up.', url,
  }, deps),
  statusChanged: (entry, status, deps) => (status === 'paid' || status === 'live') ? notifyOwner({
    kind: status, key: `${status}:${entry.id}`,
    title: status === 'paid' ? `Paid: ${label(entry)}` : `Live: ${label(entry)}`,
    body: status === 'paid' ? 'Marked paid. Time to make it live.' : 'Marked live.',
  }, deps) : Promise.resolve({ added: false }),
  builderNote: (entry, note, deps) => notifyOwner({
    kind: 'problem', key: `note:${entry.id}:${String(note).slice(0, 40)}`,
    title: `Builder needs you: ${label(entry)}`,
    body: note,
  }, deps),
};

// Cron: flag requests nobody started and builds that look stuck. Each entry alerts at most once per problem.
export async function sweepWaitlistAlerts({ store = waitlistStore, now = Date.now, deps } = {}) {
  let rows = [];
  try { rows = await store.list(100); } catch { return { checked: 0, alerted: 0 }; }
  let alerted = 0;
  for (const e of rows) {
    const age = now() - (e.updated_at || e.at || now());
    let result = null;
    if (e.status === 'waiting' && age > WAITING_MS) {
      result = await notifyOwner({ kind: 'problem', key: `waiting:${e.id}`, title: `Still waiting: ${label(e)}`, body: 'No builder has picked this up after 5 minutes.' }, deps);
    } else if (e.status === 'previewing' && age > BUILDING_MS) {
      result = await notifyOwner({ kind: 'stuck', key: `stuck:${e.id}`, title: `Build looks stuck: ${label(e)}`, body: 'Still building after 12 minutes. The visitor now sees the "we will reach out" message.' }, deps);
    }
    if (result?.added) alerted += 1;
  }
  return { checked: rows.length, alerted };
}
