// GET  /api/waitlist           -> { ok, price } public config for the page
// GET  /api/waitlist?list=1    -> operator only: entries, newest last
// POST /api/waitlist           -> submit a request to the waitlist
import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';
import { allowWaitlist, validateWaitlistEntry, waitlistPrice, waitlistStore } from '../lib/waitlist.js';

const usernameOf = (user) => (typeof user === 'string' ? user : user?.username || user?.name || '');

export async function handleWaitlist(req, res, deps = {}) {
  const store = deps.store || waitlistStore;
  const allow = deps.allow || allowWaitlist;
  const getUser = deps.getUser || getRequestUser;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'GET') {
    if (req.query?.list) {
      const username = usernameOf(await getUser(req).catch(() => null));
      if (!username || !isOperatorUser(username)) return res.status(403).json({ ok: false, error: 'Owner only.' });
      try {
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
    const result = await store.add(checked.entry);
    return res.status(200).json({ ok: true, duplicate: result.duplicate === true });
  } catch (error) {
    console.error('waitlist submit failed:', error.message);
    return res.status(503).json({ ok: false, error: 'Could not save that right now. Try again in a minute.' });
  }
}

export default function handler(req, res) { return handleWaitlist(req, res); }
