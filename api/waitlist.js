// GET  /api/waitlist                 -> { ok, price } public config for the page
// GET  /api/waitlist?list=1          -> operator only: entries, oldest first
// GET  /api/waitlist?preview=ID      -> public: the saved concept preview page (also at /p/ID), sandboxed
// GET  /api/waitlist?photo=ID&n=0    -> operator only: one attached photo (image)
// POST /api/waitlist                 -> submit a request (optional photos[] data URIs)
import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';
import { allowWaitlist, validateWaitlistEntry, waitlistPrice, waitlistStore } from '../lib/waitlist.js';
import { publicBuildStatus, wakeWaitlistBuilder } from '../lib/waitlistBuilderWake.js';

const usernameOf = (user) => (typeof user === 'string' ? user : user?.username || user?.name || '');
const PREVIEW_CSP = [
  "sandbox allow-scripts", // opaque origin: cannot touch our cookies, storage or APIs
  "default-src 'none'",
  "img-src data: https:",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');
const STATUS_ID_RE = /^[0-9a-f-]{36}$/i;
// Hosts a preview link may point at: this site, claude.ai, plus anything listed in WAITLIST_PREVIEW_HOSTS.
const previewHosts = (req, env = process.env) => [
  req.headers?.host,
  'claude.ai',
  ...String(env.WAITLIST_PREVIEW_HOSTS || '').split(',').map((h) => h.trim()),
].filter(Boolean);

export async function handleWaitlist(req, res, deps = {}) {
  const store = deps.store || waitlistStore;
  const allow = deps.allow || allowWaitlist;
  const getUser = deps.getUser || getRequestUser;
  const wake = deps.wake || wakeWaitlistBuilder;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'GET') {
    // Public build status for the loading page. The entry id is an unguessable capability; only the stage
    // (and an allowed preview link) is returned, never contact details.
    if (req.query?.status) {
      const id = String(req.query.status);
      if (!STATUS_ID_RE.test(id)) return res.status(404).json({ ok: false, error: 'Not found.' });
      try {
        const view = publicBuildStatus(await store.get(id), { allowedHosts: previewHosts(req) });
        return view ? res.status(200).json({ ok: true, ...view }) : res.status(404).json({ ok: false, error: 'Not found.' });
      } catch (error) {
        return res.status(503).json({ ok: false, error: 'Status unavailable.' });
      }
    }
    // Public concept preview. The id is an unguessable capability. The page was written by an AI from stranger-typed
    // text, so it is served inside a CSP sandbox with no same-origin access, no network calls and no forms.
    if (req.query?.preview) {
      const id = String(req.query.preview);
      if (!STATUS_ID_RE.test(id)) return res.status(404).json({ ok: false, error: 'Not found.' });
      try {
        const entry = await store.get(id);
        const html = entry && ['preview_sent', 'paid', 'live'].includes(entry.status) ? await store.getPreview(id) : null;
        if (!html) return res.status(404).json({ ok: false, error: 'Not found.' });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', PREVIEW_CSP);
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(200).send(html);
      } catch (error) {
        return res.status(503).json({ ok: false, error: 'Preview unavailable.' });
      }
    }
    if (req.query?.list || req.query?.photo) {
      const username = usernameOf(await getUser(req).catch(() => null));
      if (!username || !isOperatorUser(username)) return res.status(403).json({ ok: false, error: 'Owner only.' });
      try {
        if (req.query.photo) {
          const uri = await store.photo(String(req.query.photo), Number(req.query.n || 0));
          const m = uri && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(uri);
          if (!m) return res.status(404).json({ ok: false, error: 'No such photo.' });
          res.setHeader('Content-Type', m[1]);
          res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
          return res.status(200).send(Buffer.from(m[2], 'base64'));
        }
        return res.status(200).json({ ok: true, total: await store.count(), entries: await store.list(500) });
      } catch (error) {
        return res.status(503).json({ ok: false, error: 'Storage unavailable.' });
      }
    }
    return res.status(200).json({ ok: true, price: waitlistPrice() });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use GET or POST.' });

  const checked = validateWaitlistEntry(req.body);
  if (!checked.ok) return res.status(400).json({ ok: false, error: checked.error });
  if (checked.honeypot) return res.status(200).json({ ok: true });

  try {
    if (!(await allow(req))) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ ok: false, error: 'Too many requests from this network. Try again in an hour.' });
    }
    const result = await store.add(checked.entry, checked.photos);
    if (result.duplicate === true || !result.id) return res.status(200).json({ ok: true, duplicate: result.duplicate === true });
    // New request: wake the preview builder (best effort). Only hand back the status handle when it fired,
    // so the page shows the loading screen only when something is actually building.
    const woke = await Promise.resolve(wake(result.id)).catch(() => ({ woke: false }));
    return res.status(200).json(woke && woke.woke === true
      ? { ok: true, duplicate: false, building: true, id: result.id }
      : { ok: true, duplicate: false });
  } catch (error) {
    console.error('waitlist submit failed:', error.message);
    return res.status(503).json({ ok: false, error: 'Could not save that right now. Try again in a minute.' });
  }
}

export default function handler(req, res) { return handleWaitlist(req, res); }
