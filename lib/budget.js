// /lib/budget.js
// Persistent token + cost tracking against a monthly budget.
//
// WHY THIS EXISTS: the header counter in index.html was only ever a
// session total, rebuilt from the 12-message rolling KV buffer. As
// older messages aged out of that buffer the number silently shrank,
// and it reset entirely on a fresh browser. It could tell you what a
// conversation cost; it could never tell you what you had LEFT.
//
// WHAT THIS CANNOT DO — read this before trusting the number:
//   1. It cannot read your real Anthropic account balance. No API
//      exposes that here. "Remaining" means remaining against the
//      budget number YOU set in NEX_MONTHLY_BUDGET_USD, measured from
//      usage this app observed.
//   2. It only sees traffic through this app. Spend from Claude's
//      connector sessions, the Anthropic console, or anything else is
//      invisible to it. Treat it as a floor on spend, not the truth.
//   3. The prices below are ESTIMATES (see PRICING). Wrong prices give
//      you a confidently wrong dollar figure, which is worse than none.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Monthly allowance in USD. Override via env without touching code.
const DEFAULT_BUDGET_USD = 20;

// ============================================================
// PRICING — USD per 1,000,000 tokens.
//
// !!! THESE ARE UNVERIFIED PLACEHOLDERS !!!
// Nex could not confirm real rates for claude-sonnet-5 or
// claude-opus-5. Correct them against Anthropic's pricing page.
// Everything else in this file is sound; only these numbers are
// guesses, and they are isolated here so fixing them is a one-spot
// edit with no other code changes needed.
// ============================================================
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-opus-5': { input: 15.0, output: 75.0 },
};

// Used when an unrecognized model string shows up (e.g. a tier gets
// repointed at a new model id and this file wasn't updated). Assuming
// mid-tier pricing beats silently counting it as free.
const FALLBACK_PRICE = { input: 3.0, output: 15.0 };

// Rough blended rate for projecting "tokens left" before we have any
// real usage this month to measure an actual blend from.
const FALLBACK_BLENDED_PER_TOKEN = 6.0 / 1e6;

function monthLabel(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthKey(d = new Date()) {
  return `nex:budget:${monthLabel(d)}`;
}

function budgetLimit() {
  const raw = Number(process.env.NEX_MONTHLY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_USD;
}

// Thin Upstash REST helper. Path segments are encoded individually so
// model ids containing dots/dashes can't break the URL.
async function kv(segments) {
  const url = `${KV_URL}/${segments.map((s) => encodeURIComponent(String(s))).join('/')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('text/html')) {
    throw new Error(`KV request failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Record one turn's usage against the current month.
 *
 * Uses hash increments (HINCRBY / HINCRBYFLOAT) rather than
 * read-modify-write on purpose: increments are atomic server-side, so
 * two requests finishing at the same moment can't clobber each other's
 * totals the way a get-then-set would.
 *
 * Never throws. Budget accounting failing must not break a reply —
 * losing a tally entry is annoying, losing Nex's answer is not
 * acceptable.
 */
export async function recordUsage(model, usage) {
  if (!KV_URL || !KV_TOKEN) {
    console.error('recordUsage: missing KV env vars, skipping');
    return;
  }
  if (!usage) return;

  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  if (inputTokens === 0 && outputTokens === 0) return;

  const price = PRICING[model] || FALLBACK_PRICE;
  if (!PRICING[model]) {
    console.warn(`recordUsage: unknown model "${model}", billing at fallback rate`);
  }

  const cost = (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
  const key = monthKey();

  try {
    await Promise.all([
      kv(['hincrby', key, 'input_tokens', inputTokens]),
      kv(['hincrby', key, 'output_tokens', outputTokens]),
      kv(['hincrbyfloat', key, 'cost_usd', cost.toFixed(8)]),
      kv(['hincrby', key, 'calls', 1]),
      kv(['hincrby', key, `tokens:${model}`, inputTokens + outputTokens]),
    ]);
  } catch (err) {
    console.error('recordUsage failed (non-fatal):', err.message);
  }
}

/**
 * Current month's spend + what's left. Always resolves to a usable
 * shape, even if KV is unreachable — the UI should degrade to "budget
 * unavailable" rather than crash or render NaN.
 */
export async function getBudgetStatus() {
  const limitUsd = budgetLimit();
  const month = monthLabel();

  const empty = {
    month,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    limitUsd,
    remainingUsd: limitUsd,
    percentUsed: 0,
    approxTokensLeft: Math.round(limitUsd / FALLBACK_BLENDED_PER_TOKEN),
    calls: 0,
    perModel: {},
    pricingVerified: false,
    tracked: false,
  };

  if (!KV_URL || !KV_TOKEN) return empty;

  try {
    const data = await kv(['hgetall', monthKey()]);
    const raw = data.result;

    // Nothing recorded yet this month — a clean slate, not an error.
    if (!raw || (Array.isArray(raw) && raw.length === 0)) {
      return { ...empty, tracked: true };
    }

    // Upstash returns a flat [field, value, field, value, ...] array.
    const h = {};
    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i += 2) h[raw[i]] = raw[i + 1];
    } else if (typeof raw === 'object') {
      Object.assign(h, raw);
    }

    const inputTokens = Number(h.input_tokens || 0);
    const outputTokens = Number(h.output_tokens || 0);
    const totalTokens = inputTokens + outputTokens;
    const costUsd = Number(h.cost_usd || 0);

    const perModel = {};
    Object.keys(h).forEach((k) => {
      if (k.startsWith('tokens:')) perModel[k.slice('tokens:'.length)] = Number(h[k]);
    });

    const remainingUsd = Math.max(0, limitUsd - costUsd);
    const percentUsed = limitUsd > 0 ? Math.min(100, (costUsd / limitUsd) * 100) : 0;

    // Project remaining tokens using this month's OWN observed blend of
    // Haiku/Sonnet/Opus, so the estimate tracks how Nex is actually
    // being used rather than a fixed assumption.
    const blendedPerToken =
      totalTokens > 0 && costUsd > 0 ? costUsd / totalTokens : FALLBACK_BLENDED_PER_TOKEN;

    return {
      month,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      limitUsd,
      remainingUsd,
      percentUsed,
      approxTokensLeft: Math.max(0, Math.round(remainingUsd / blendedPerToken)),
      calls: Number(h.calls || 0),
      perModel,
      pricingVerified: false,
      tracked: true,
    };
  } catch (err) {
    console.error('getBudgetStatus failed:', err.message);
    return empty;
  }
}
