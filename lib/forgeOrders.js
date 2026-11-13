import './store/installFetch.js';
// Build orders: when a prospect likes a demo, the caller records WHICH look they picked plus the owner's notes.
// Ops sees them as the build queue. Nothing is built, sent or charged from here.
const KV_URL = process.env.KV_REST_API_URL, KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'nexus:forge:orders';
export const ORDER_STATUSES = ['new', 'building', 'live'];

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error('Order store failed.');
  return data.result;
}
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, n);

export async function getOrder(leadId, { redis = redisCommand } = {}) {
  const raw = await redis(['HGET', KEY, leadId]);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export async function listOrders({ redis = redisCommand } = {}) {
  const flat = await redis(['HGETALL', KEY]);
  const out = [];
  if (Array.isArray(flat)) for (let i = 1; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i])); } catch { /* skip bad row */ } }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Snapshot of what the prospect saw, so the build matches it even if the demo is edited afterwards.
export async function saveOrder(lead, { lookId, notes, by }, { redis = redisCommand, now = Date.now } = {}) {
  const looks = Array.isArray(lead.siteVariants) ? lead.siteVariants : [];
  const look = looks.find(v => v.id === lookId);
  if (!look) return { error: 'Pick one of this lead’s saved looks.' };
  const prev = await getOrder(lead.id, { redis });
  const t = now();
  const order = {
    leadId: lead.id, businessName: lead.businessName, phone: lead.phone || '', category: lead.category || '', location: lead.location || '',
    lookId: look.id, lookLabel: look.label || look.id, notes: clip(notes, 1500),
    siteContent: lead.siteContent || null, sitePalette: lead.sitePalette || '',
    status: prev?.status || 'new', savedBy: by || null, createdAt: prev?.createdAt || t, updatedAt: t
  };
  await redis(['HSET', KEY, lead.id, JSON.stringify(order)]);
  return { order };
}
export async function setOrderStatus(leadId, status, { redis = redisCommand, now = Date.now, liveUrl } = {}) {
  if (!ORDER_STATUSES.includes(status)) return { error: 'Status must be new, building or live.' };
  const url = String(liveUrl || '').trim();
  if (url && !/^https:\/\/[^\s<>"']{4,290}$/.test(url)) return { error: 'The live site link must start with https://' };
  const o = await getOrder(leadId, { redis });
  if (!o) return { error: 'No such order.' };
  o.status = status; o.updatedAt = now();
  if (url) o.liveUrl = url;
  await redis(['HSET', KEY, leadId, JSON.stringify(o)]);
  return { order: o };
}
