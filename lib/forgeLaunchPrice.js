import './store/installFetch.js';
// Forge Launch pricing the owner can change in Forge Ops. Applies to NEW sign-ups only:
// each checkout builds its prices when the link is made, and existing subscriptions keep what they signed up at.
const KEY = 'nexus:forge:pricing';
const KV_URL = process.env.KV_REST_API_URL, KV_TOKEN = process.env.KV_REST_API_TOKEN;
export const DEFAULT_PRICING = Object.freeze({ firstChargeCents: 5000, monthlyCents: 2500 });
export const LIMITS = Object.freeze({ minMonthly: 500, maxMonthly: 50000, maxFirst: 100000 });

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error('Pricing store failed.');
  return data.result;
}

export function shape(p = {}) {
  const first = p.firstChargeCents, monthly = p.monthlyCents;
  return { firstChargeCents: first, monthlyCents: monthly, activationCents: first - monthly, updatedAt: p.updatedAt || null, updatedBy: p.updatedBy || null };
}

export function validatePricing(input) {
  const first = Number(input?.firstChargeCents), monthly = Number(input?.monthlyCents);
  if (!Number.isInteger(first) || !Number.isInteger(monthly)) return { error: 'Enter whole-cent amounts.' };
  if (monthly < LIMITS.minMonthly || monthly > LIMITS.maxMonthly) return { error: 'Monthly must be between $5 and $500.' };
  if (first < monthly) return { error: 'The first charge has to include at least the first month.' };
  if (first > LIMITS.maxFirst) return { error: 'First charge can be at most $1,000.' };
  return { value: { firstChargeCents: first, monthlyCents: monthly } };
}

// Never throws: if the store is down, sign-ups and pitches fall back to the default so nothing breaks.
export async function getPricing({ redis = redisCommand } = {}) {
  try {
    const raw = await redis(['GET', KEY]);
    const v = raw ? validatePricing(JSON.parse(raw)) : null;
    if (v?.value) { const j = JSON.parse(raw); return shape({ ...v.value, updatedAt: j.updatedAt, updatedBy: j.updatedBy }); }
  } catch { /* use default */ }
  return shape(DEFAULT_PRICING);
}

export async function setPricing(input, by, { redis = redisCommand, now = Date.now } = {}) {
  const v = validatePricing(input);
  if (v.error) return v;
  const record = { ...v.value, updatedAt: now(), updatedBy: by || null };
  await redis(['SET', KEY, JSON.stringify(record)]);
  return { pricing: shape(record) };
}

// Offer shape the pitch script and caller page read.
export function offerFromPricing(p) {
  return { tiers: [{ key: 'launch', name: 'Launch', priceCents: p.monthlyCents, signUpCents: p.firstChargeCents, editsPerMonth: null, editsPromoLabel: 'unlimited minor edits during launch', aiAssistant: false }] };
}
