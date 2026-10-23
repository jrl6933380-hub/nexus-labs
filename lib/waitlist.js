import {createHash, randomUUID} from 'node:crypto';
import {teamCommand} from './teamRuns.js';
import {clientIp} from './connectRateLimit.js';

// TikTok / ad waitlist. Visitors describe what they want built (plus optional
// photos and notes); the owner reviews entries, makes a preview, and only then
// sends a payment link. v1 stores entries in Redis (same store the Board uses)
// and sends no email: the Resend sender can only reach the account owner until
// a domain is verified.

// Price shown on the page for going live (first month) and monthly after.
// One setting. Override with the WAITLIST_PRICE_USD env var (1-99).
export function waitlistPrice(env = process.env) {
  const n = Number(env.WAITLIST_PRICE_USD);
  return Number.isFinite(n) && n >= 1 && n <= 99 ? Math.round(n) : 9;
}

export const WAITLIST_STATUSES = ['waiting', 'previewing', 'preview_sent', 'paid', 'live', 'passed'];
export const WAITLIST_KINDS = ['website', 'ai_helper', 'both', 'other'];
export const MAX_PHOTOS = 4;
export const MAX_PHOTO_CHARS = 200_000; // data URI length; the page shrinks photos to fit
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAGIC = { jpeg: '/9j/', png: 'iVBOR', webp: 'UklGR' };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '');
const cleanMultiline = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '');
const fail = (error) => ({ ok: false, error });

export function validatePhotos(input) {
  if (input == null) return { ok: true, photos: [] };
  if (!Array.isArray(input)) return fail('Photos must be a list.');
  if (input.length > MAX_PHOTOS) return fail(`Add up to ${MAX_PHOTOS} photos.`);
  const photos = [];
  for (const uri of input) {
    if (typeof uri !== 'string' || uri.length > MAX_PHOTO_CHARS) return fail('One of your photos is too large. Try a smaller one.');
    const m = PHOTO_RE.exec(uri);
    if (!m || !m[2].startsWith(MAGIC[m[1]])) return fail('Photos must be JPEG, PNG or WebP images.');
    photos.push(uri);
  }
  return { ok: true, photos };
}

export function validateWaitlistEntry(body) {
  const b = body && typeof body === 'object' ? body : {};
  // Honeypot: real people never fill this hidden field. Pretend success, store nothing.
  if (clean(b.company_website)) return { ok: true, honeypot: true };

  const what = clean(b.what);
  const extra = cleanMultiline(b.extra);
  const business = clean(b.business);
  const name = clean(b.name);
  const links = clean(b.links);
  const email = clean(b.email).toLowerCase();
  const phone = clean(b.phone).replace(/[^\d+]/g, '');
  const digits = phone.replace(/\D/g, '');
  const kind = WAITLIST_KINDS.includes(b.kind) ? b.kind : 'website';

  if (what.length < 10) return fail('Tell us a little more about what you want (at least 10 characters).');
  if (what.length > 600) return fail('Keep what you want under 600 characters. Use the extra box for more.');
  if (extra.length > 1500) return fail('Keep the extra notes under 1500 characters.');
  if (business.length > 80) return fail('Business name must be 80 characters or fewer.');
  if (name.length > 80) return fail('Name must be 80 characters or fewer.');
  if (links.length > 300) return fail('Links must be 300 characters or fewer.');
  if (!email && !digits) return fail('Add an email or a phone number so we can reach you.');
  if (email && (email.length > 120 || !EMAIL_RE.test(email))) return fail('That email does not look right.');
  if (digits && (digits.length < 10 || digits.length > 15)) return fail('That phone number does not look right.');
  if (b.consent !== true) return fail('Please agree to be contacted about your preview.');

  const p = validatePhotos(b.photos);
  if (!p.ok) return p;

  return { ok: true, entry: { name, business, kind, what, extra, links, email, phone: digits ? phone : '', consent: true }, photos: p.photos };
}

const ENTRIES = 'nexus:waitlist:v1:entries';
const SEEN = 'nexus:waitlist:v1:seen:';
const previewKey = (id) => `nexus:waitlist:v1:preview:${id}`;
export const MAX_PREVIEW_CHARS = 200_000;
const PREVIEW_TTL_SECONDS = 60 * 60 * 24 * 45;
const photoKey = (id, n) => `nexus:waitlist:v1:photo:${id}:${n}`;
const contactKey = (entry) => createHash('sha256').update(entry.email || entry.phone.replace(/\D/g, '')).digest('hex').slice(0, 40);

export function createWaitlistStore({ command = teamCommand, now = Date.now, id = randomUUID } = {}) {
  const readAll = async (limit = 200) => {
    const cap = Math.max(1, Math.min(500, Math.floor(limit) || 200));
    const raw = await command(['LRANGE', ENTRIES, '0', String(cap - 1)]);
    return (Array.isArray(raw) ? raw : []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  };
  return {
    // One entry per contact. A repeat submit returns { duplicate: true } and stores nothing.
    async add(entry, photos = []) {
      const seenKey = SEEN + contactKey(entry);
      const fresh = await command(['SET', seenKey, '1', 'NX']);
      if (fresh !== 'OK') return { duplicate: true };
      const entryId = id();
      const record = { id: entryId, at: now(), status: 'waiting', ...entry, photos: photos.length };
      try {
        for (let i = 0; i < photos.length; i++) await command(['SET', photoKey(entryId, i), photos[i]]);
        const position = Number(await command(['RPUSH', ENTRIES, JSON.stringify(record)]));
        return { duplicate: false, position, id: entryId };
      } catch (error) {
        await command(['DEL', seenKey]).catch(() => {});
        for (let i = 0; i < photos.length; i++) await command(['DEL', photoKey(entryId, i)]).catch(() => {});
        throw error;
      }
    },
    async photo(entryId, n) {
      if (!/^[0-9a-f-]{8,40}$/i.test(String(entryId)) || !Number.isInteger(n) || n < 0 || n >= MAX_PHOTOS) return null;
      const uri = await command(['GET', photoKey(entryId, n)]);
      return typeof uri === 'string' ? uri : null;
    },
    // Concept preview page the builder saved for an entry. Served publicly at /p/<id> inside a sandbox.
    async savePreview(entryId, html) {
      if (!/^[0-9a-f-]{8,40}$/i.test(String(entryId)) || typeof html !== 'string' || !html.trim() || html.length > MAX_PREVIEW_CHARS) return false;
      await command(['SET', previewKey(entryId), html, 'EX', String(PREVIEW_TTL_SECONDS)]);
      return true;
    },
    async getPreview(entryId) {
      if (!/^[0-9a-f-]{8,40}$/i.test(String(entryId))) return null;
      const html = await command(['GET', previewKey(entryId)]);
      return typeof html === 'string' && html ? html : null;
    },
    async list(limit = 200) { return readAll(limit); },
    async count() { return Number(await command(['LLEN', ENTRIES])) || 0; },
    async get(entryId) { return (await readAll(500)).find((e) => e.id === entryId) || null; },
    // Owner follow-up: change a lead's status and/or leave a short note.
    async update(entryId, patch) {
      const raw = await command(['LRANGE', ENTRIES, '0', '499']);
      const rows = Array.isArray(raw) ? raw : [];
      for (let i = 0; i < rows.length; i++) {
        let row; try { row = JSON.parse(rows[i]); } catch { continue; }
        if (row.id !== entryId) continue;
        const next = { ...row, ...(patch.status ? { status: patch.status } : {}), ...(patch.note !== undefined ? { note: patch.note } : {}), updated_at: now() };
        await command(['LSET', ENTRIES, String(i), JSON.stringify(next)]);
        return next;
      }
      return null;
    },
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
