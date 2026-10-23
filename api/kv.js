// Redis-compatible HTTP endpoint (same shape as Upstash REST) for workers that run outside Vercel, so they can use
// the same database through the app. Authenticated with the existing KV_REST_API_TOKEN-style shared secret.
import '../lib/store/installFetch.js';
import { timingSafeEqual } from 'node:crypto';
import { getStore } from '../lib/store/index.js';
import { handleKvRequest } from '../lib/store/installFetch.js';

function sameSecret(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const secret = process.env.NEXUS_KV_TOKEN || '';
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || !sameSecret(given, secret)) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const store = getStore();
  if (!store) { res.status(503).json({ error: 'database not configured' }); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const path = String(req.query?.path || '').replace(/^\/?/, '/').replace(/\/+$/, '');
  const response = await handleKvRequest(store, path === '/' ? '' : path, Buffer.concat(chunks).toString('utf8'));
  res.status(response.status).setHeader('content-type', 'application/json').send(await response.text());
}
