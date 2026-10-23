// Owner inbox: the little bell in Nexus. One shared inbox for the single owner.
// Events (new waitlist request, preview ready, preview opened, paid, problems) land here and the bell reads them.
//
// - Best effort: notify() never throws, so an alert problem can never break a signup or a build.
// - Optional dedupe key so the same event is only shown once (retries, bots, repeat polls).
// - Text only. Titles and bodies can contain stranger-typed words, so they are length-capped here and the UI
//   renders them with textContent, never as HTML.
import { createHash, randomUUID } from 'node:crypto';
import { teamCommand } from './teamRuns.js';

const LIST = 'nexus:alerts:v1:items';
const READ_AT = 'nexus:alerts:v1:read_at';
const SEEN = 'nexus:alerts:v1:seen:';
const MAX_ITEMS = 200;
const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 60;
export const ALERT_KINDS = ['new_request', 'preview_ready', 'preview_viewed', 'paid', 'live', 'stuck', 'problem'];

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// Only same-site paths or https links may be attached to an alert.
const safeUrl = (u) => {
  const s = String(u || '').trim();
  if (/^\/(?!\/)[^\s]{0,300}$/.test(s)) return s;
  try { const x = new URL(s); return x.protocol === 'https:' && s.length <= 400 ? x.href : ''; } catch { return ''; }
};

export function createAlertStore({ command = teamCommand, now = Date.now, id = randomUUID } = {}) {
  return {
    // Returns { added, id } or { added:false }. `key` makes the event idempotent.
    async push({ kind, title, body = '', url = '', key = '' }) {
      if (!ALERT_KINDS.includes(kind)) throw new Error('Unknown alert kind');
      const t = clean(title, 120);
      if (!t) throw new Error('An alert needs a title');
      if (key) {
        const fresh = await command(['SET', SEEN + createHashKey(key), '1', 'NX', 'EX', String(DEDUPE_TTL_SECONDS)]);
        if (fresh !== 'OK') return { added: false };
      }
      const item = { id: id(), at: now(), kind, title: t, body: clean(body, 240), url: safeUrl(url) };
      await command(['LPUSH', LIST, JSON.stringify(item)]);
      await command(['LTRIM', LIST, '0', String(MAX_ITEMS - 1)]);
      return { added: true, id: item.id };
    },
    // Newest first, with unread flags and a count (the count covers everything kept, not just this page).
    async list(limit = 30) {
      const cap = Math.max(1, Math.min(MAX_ITEMS, Math.floor(limit) || 30));
      const [raw, readRaw] = await Promise.all([command(['LRANGE', LIST, '0', String(MAX_ITEMS - 1)]), command(['GET', READ_AT])]);
      const readAt = Number(readRaw) || 0;
      const all = (Array.isArray(raw) ? raw : []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean)
        .map((a) => ({ ...a, unread: a.at > readAt }));
      return { unread: all.filter((a) => a.unread).length, items: all.slice(0, cap) };
    },
    async markRead() { await command(['SET', READ_AT, String(now())]); return { unread: 0 }; },
  };
}
const createHashKey = (k) => createHash('sha256').update(String(k)).digest('hex').slice(0, 40);

export const alertStore = createAlertStore();

// Fire-and-forget helper used by the waitlist code. Never throws, never blocks long.
export async function notifyOwner(event, { store = alertStore } = {}) {
  try { return await store.push(event); } catch { return { added: false }; }
}
