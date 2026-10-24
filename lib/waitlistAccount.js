// Customer "account" for a waitlist entry: a signed token that proves "this browser belongs to the person who made
// this entry", so the waitlist page can send them back to their preview or live site without a login.
// - The entry id alone is NOT enough: preview links (/p/<id>) get shared. The token adds an HMAC only we can make.
// - The secret is WAITLIST_TOKEN_SECRET, falling back to STRIPE_WEBHOOK_SECRET so it works with no extra setup.
// - Tokens carry no personal data and give read-only access to the stage and links shown by accountView().
import { createHmac, timingSafeEqual } from 'node:crypto';

const ID_RE = /^[0-9a-f-]{36}$/i;
const secretOf = (env) => String(env.WAITLIST_TOKEN_SECRET || env.STRIPE_WEBHOOK_SECRET || '');
const mac = (id, secret) => createHmac('sha256', secret).update('waitlist-account:' + id).digest('hex').slice(0, 40);

export function signEntryToken(entryId, env = process.env) {
  const secret = secretOf(env);
  if (!secret || !ID_RE.test(String(entryId))) return '';
  return `${entryId}.${mac(entryId, secret)}`;
}

// Returns the entry id when the token is genuine, otherwise null.
export function verifyEntryToken(token, env = process.env) {
  const secret = secretOf(env);
  const t = String(token || '');
  const dot = t.indexOf('.');
  if (!secret || dot !== 36) return null;
  const id = t.slice(0, dot), given = t.slice(dot + 1);
  if (!ID_RE.test(id)) return null;
  const want = Buffer.from(mac(id, secret)), got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

// Only https links to a real host, no embedded credentials. Used for the finished site address.
export function validSiteUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || String(value).length > 300) return '';
    return u.href;
  } catch { return ''; }
}

const STAGES = { waiting: 'queued', previewing: 'building', preview_sent: 'preview', paid: 'setup', live: 'live', passed: 'closed' };

// What the signed-in customer may see about their own entry. Never contact details or the owner's note.
export function accountView(entry) {
  if (!entry) return null;
  const stage = STAGES[entry.status] || 'queued';
  const out = { id: entry.id, stage, business: String(entry.business || entry.name || '').slice(0, 80) };
  if (['preview', 'setup', 'live'].includes(stage)) out.preview_url = `/p/${entry.id}`;
  if (stage === 'live' && entry.site_url) out.site_url = entry.site_url;
  return out;
}
