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
