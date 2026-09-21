// lib/forge/brainProviders.js
//
// Provider adapters behind one interface, so provider-specific logic never
// leaks into routes or UI. Today there is exactly one real adapter
// (OpenRouter); the boundary exists anyway because depending on a single
// company for every customer's access to every model is the one structural
// risk of this design, and the adapter is what keeps that reversible.
//
// interface BrainProviderAdapter {
//   id, name, tiers
//   beginAuthorization({ username, callbackUrl }) -> { redirectUrl, state, codeVerifier }
//   exchangeCode({ code, codeVerifier }) -> { key }
//   testConnection(key) -> { ok, label, usage, limit, free }
//   listModels(key) -> [{ id, name }]
// }

import crypto from 'node:crypto';

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * OpenRouter's PKCE flow. Chosen because it needs no client secret and no app
 * registration: the user clicks once, authorizes, and a key is minted on their
 * own account, so usage and billing stay theirs.
 *
 * Note on a deliberate deviation: OpenRouter's reference implementation stores
 * the minted key in the browser's localStorage. We exchange the code
 * server-side and keep the key encrypted in KV instead. A bearer credential
 * that can spend a customer's money has no business in a browser.
 */
const openrouter = {
  id: 'openrouter',
  name: 'OpenRouter',
  tiers: [
    // openrouter/free is the Free Models Router: $0 in, $0 out. It picks a free
    // model at random, filtering for the features the request needs.
    //
    // NOT openrouter/auto — that is the *paid* auto-router. Wiring it to a
    // button labelled "Free" is how the free tier ended up returning 402 for a
    // user with no credit, which is the worst possible first experience.
    { id: 'free',   label: 'Free',   blurb: 'Start building, no card needed', model: 'openrouter/free' },
    { id: 'fast',   label: 'Fast',   blurb: 'Quicker, for lots of small changes', model: 'anthropic/claude-haiku-4.5' },
    { id: 'strong', label: 'Strong', blurb: 'For the hard stuff', model: 'anthropic/claude-sonnet-4.5' },
  ],

  beginAuthorization({ callbackUrl }) {
    if (!callbackUrl) throw new Error('callbackUrl is required');
    // The verifier never leaves the server; only `state` is round-tripped
    // through the browser, and it is a lookup handle, not a secret that grants
    // anything on its own.
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = base64url(crypto.randomBytes(18));
    const url = new URL('https://openrouter.ai/auth');
    url.searchParams.set('callback_url', callbackUrl);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return { redirectUrl: url.toString(), state, codeVerifier };
  },

  async exchangeCode({ code, codeVerifier }) {
    if (!code) throw new Error('Authorization code is missing');
    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: 'S256' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.key) {
      // Never echo the provider's raw body: it can contain fragments of the
      // exchange. A stable message is enough for the user, and the status code
      // is enough for us.
      throw new Error(`Could not finish connecting (provider returned ${response.status})`);
    }
    return { key: data.key };
  },

  async testConnection(key) {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      return { ok: false, label: response.status === 401 ? 'That connection was rejected' : 'Connection test failed' };
    }
    const body = await response.json().catch(() => ({}));
    const data = body?.data || body || {};
    return {
      ok: true,
      label: 'Working',
      usage: typeof data.usage === 'number' ? data.usage : null,
      limit: typeof data.limit === 'number' ? data.limit : null,
      free: data.is_free_tier === true || data.limit === 0,
    };
  },

  async listModels(key) {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    if (!response.ok) return [];
    const body = await response.json().catch(() => ({}));
    const list = Array.isArray(body?.data) ? body.data : [];
    return list.slice(0, 200).map((model) => ({ id: model.id, name: model.name || model.id }));
  },
};

const ADAPTERS = { openrouter };

export function getAdapter(id = 'openrouter') {
  const adapter = ADAPTERS[id];
  if (!adapter) throw new Error(`Unknown brain provider: ${id}`);
  return adapter;
}

export function listAdapters() {
  return Object.values(ADAPTERS).map(({ id, name, tiers }) => ({ id, name, tiers }));
}

/** The model a tier maps to. Forge routes; the customer's connection pays. */
export function modelForTier(providerId, tierId) {
  const adapter = getAdapter(providerId);
  const tier = adapter.tiers.find((t) => t.id === tierId);
  return (tier || adapter.tiers[0]).model;
}

/**
 * Output budget per tier.
 *
 * The Free router picks among many open-weight models, and a lot of them have
 * far smaller output ceilings than Anthropic's. Asking for 16k there does not
 * get 16k — the model simply stops early, mid-document, and the truncation
 * guard correctly refuses to save half a page. Asking for a realistic amount
 * and building in fewer, tighter passes works; asking for more does not.
 *
 * `compact` additionally tells the builder to scope down harder, because on
 * Free the practical constraint is the model's ceiling, not the customer's
 * ambition.
 */
export function budgetForTier(tierId) {
  // The free router can pick a slow reasoning model. A long first pass plus
  // several continuations used the entire 110s request without closing HTML.
  // Aim for a small complete first version; edits can add features afterward.
  if (tierId === 'free') return { maxTokens: 4000, compact: true, maxRounds: 4 };
  if (tierId === 'fast') return { maxTokens: 16000, compact: false };
  return { maxTokens: 16000, compact: false };
}

const COMPACT_DIRECTIVE = `\n\nOUTPUT BUDGET — IMPORTANT\nYou have a modest output ceiling on this build. Produce ONE complete, genuinely working page that fits comfortably: the core layout and the single most important interaction, fully finished and properly closed. Prefer fewer sections done completely over many sections cut off. Always finish with a closing </html> tag. A smaller page that is complete is the goal; an elaborate one that stops mid-file is a failure.`;

/** A build is done when the document actually closes, not when the model stops. */
export function looksComplete(text) {
  return /<\/html\s*>/i.test(text);
}

/**
 * Drops a continuation that restarted the document, and trims an overlapping
 * seam when the model repeats its own last few characters. Without this, a
 * model that ignores "do not repeat" produces a visibly duplicated page.
 */
export function stripRepeatedPrefix(accumulated, next) {
  if (!next) return '';
  if (/^\s*<!DOCTYPE/i.test(next) && /<!DOCTYPE/i.test(accumulated)) return '';
  const maxOverlap = Math.min(200, accumulated.length, next.length);
  for (let size = maxOverlap; size > 20; size--) {
    if (accumulated.endsWith(next.slice(0, size))) return next.slice(size);
  }
  return next;
}

/** Original turns, the partial document as the model's own turn, then continue. */
export function continuationMessages(original, accumulated) {
  return [
    ...original,
    { role: 'assistant', content: accumulated },
    {
      role: 'user',
      content: 'Continue the document from exactly where you stopped. Do not repeat any text you have already written, do not restart, and do not add commentary — output only the remaining markup, continuing mid-line if that is where you left off.',
    },
  ];
}

/** Hard ceiling on continuation rounds, so a model that never closes the
 *  document cannot loop until it drains the customer's credit. */
export const MAX_CONTINUATION_ROUNDS = 4;
