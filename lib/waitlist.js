import {createHash, randomUUID} from 'node:crypto';
import {teamCommand} from './teamRuns.js';
import {clientIp} from './connectRateLimit.js';

// TikTok / ad waitlist. Visitors describe what they want built; the owner
// reviews entries, makes a preview, and only then sends a payment link.
// v1 stores entries in Redis (same store the Board uses) and sends no email:
// the Resend sender can only reach the account owner until a domain is verified.

// Price shown on the page for going live (first month) and monthly after.
// One setting. Override with the WAITLIST_PRICE_USD env var (1-99).
export function waitlistPrice(env = process.env) {
  const n = Number(env.WAITLIST_PRICE_USD);
  return Number.isFinite(n) && n >= 1 && n <= 99 ? Math.round(n) : 9;
}

export const WAITLIST_KINDS = ['website', 'ai_helper', 'both', 'other'];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '');
const fail = (error) => ({ ok: false, error });

export function validateWaitlistEntry(body) {
  const b = body && typeof body === 'object' ? body : {};
  // Honeypot: real people never fill this hidden field. Pretend success, store nothing.
  if (clean(b.company_website)) return { ok: true, honeypot: true };

  const what = clean(b.what);
  const business = clean(b.business);
  const name = clean(b.name);
  const links = clean(b.links);
  const email = clean(b.email).toLowerCase();
  const phone = clean(b.phone).replace(/[^\d+]/g, '');
  const digits = phone.replace(/\D/g, '');
  const kind = WAITLIST_KINDS.includes(b.kind) ? b.kind : 'website';

  if (what.length < 10) return fail('Tell us a little more about what you want (at least 10 characters).');
  if (what.length > 600) return fail('Keep what you want under 600 characters. You can add detail later.');
  if (business.length > 80) return fail('Business name must be 80 characters or fewer.');
  if (name.length > 80) return fail('Name must be 80 characters or fewer.');
  if (links.length > 300) return fail('Links must be 300 characters or fewer.');
  if (!email && !digits) return fail('Add an email or a phone number so we can reach you.');
  if (email && (email.length > 120 || !EMAIL_RE.test(email))) return fail('That email does not look right.');
  if (digits && (digits.length < 10 || digits.length > 15)) return fail('That phone number does not look right.');
  if (b.consent !== true) return fail('Please agree to be contacted about your preview.');

  return { ok: true, entry: { name, business, kind, what, links, email, phone: digits ? phone : '', consent: true } };
}

const ENTRIES = 'nexus:waitlist:v1:entries';
const SEEN = 'nexus:waitlist:v1:seen:';
const contactKey = (entry) => createHash('sha256').update(entry.email || entry.phone.replace(/\D/g, '')).digest('hex').slice(0, 40);

export function createWaitlistStore({ command = teamCommand, now = Date.now, id = randomUUID } = {}) {
  return {
    // One entry per contact. A repeat submit returns { duplicate: true } and stores nothing.
    async add(entry) {
      const seenKey = SEEN + contactKey(entry);
      const fresh = await command(['SET', seenKey, '1', 'NX']);
      if (fresh !== 'OK') return { duplicate: true };
      const record = { id: id(), at: now(), status: 'waiting', ...entry };
      try {
        const position = Number(await command(['RPUSH', ENTRIES, JSON.stringify(record)]));
        return { duplicate: false, position, id: record.id };
      } catch (error) {
        await command(['DEL', seenKey]).catch(() => {});
        throw error;
      }
    },
    async list(limit = 200) {
      const cap = Math.max(1, Math.min(500, Math.floor(limit) || 200));
      const raw = await command(['LRANGE', ENTRIES, '0', String(cap - 1)]);
      return (Array.isArray(raw) ? raw : []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    },
    async count() { return Number(await command(['LLEN', ENTRIES])) || 0; },
  };
}
export const waitlistStore = createWaitlistStore();

// Fixed-window limit per IP so the public form cannot be flooded.
export async function allowWaitlist(req, { limit = 6, windowSeconds = 3600, command = teamCommand, now = Date.now } = {}) {
  const bucket = Math.floor(now() / 1000 / windowSeconds);
  const key = `nexus:waitlist:v1:rate:${createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 32)}:${bucket}`;
  const count = Number(await command(['INCR', key]));
  if (count === 1) await command(['EXPIRE', key, String(windowSeconds * 2)]);
  return count <= limit;
}
