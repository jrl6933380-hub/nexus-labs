// lib/forge/provisioning.js
//
// Mints a spend-capped OpenRouter key per customer, so someone can start
// building the moment they sign up instead of going away to create an
// account with a model provider first.
//
// Why this exists rather than one shared platform key: a shared key's only
// protection against a runaway bill is our own metering code behaving
// correctly. That code is good, but a single reservation bug, retry loop, or
// double-call would spend against the whole balance. Forge has already shipped
// all three of those bug shapes in one night against free-tier keys, where the
// cost was a failed request. Against a funded key the same bug is a bill.
//
// A per-customer key puts a hard ceiling at the PROVIDER, underneath our meter:
// worst case a bug costs one customer's cap instead of the balance. The meter
// is still the primary control; this is the floor under it.
//
// The provisioning key itself is a master credential — it can mint and revoke
// keys — so it is read from the environment here and never leaves the server,
// never reaches a response body, and never enters a model prompt.

const PROVISIONING_KEY = process.env.OPENROUTER_PROVISIONING_KEY;
const KEYS_ENDPOINT = 'https://openrouter.ai/api/v1/keys';

/** Default spend ceiling per customer key, in USD. */
const DEFAULT_KEY_LIMIT_USD = Number(process.env.FORGE_FUNDED_KEY_LIMIT_USD || 2);

export function provisioningConfigured() {
  return Boolean(PROVISIONING_KEY);
}

/**
 * Mints a new customer key. Returns { key, hash, limit } — `key` is the raw
 * credential and must go straight into encrypted storage; `hash` is
 * OpenRouter's identifier for later lookup/revocation and is safe to keep
 * alongside the record.
 *
 * The limit is a hard provider-side ceiling for the life of the key, not a
 * per-day figure: the daily allowance is enforced by lib/roomMetering.js. This
 * is the backstop for when that fails, which is exactly why it must not be
 * generous.
 */
export async function mintCustomerKey(username, { limitUsd = DEFAULT_KEY_LIMIT_USD } = {}) {
  if (!PROVISIONING_KEY) throw new Error('OPENROUTER_PROVISIONING_KEY is not configured');
  if (!username) throw new Error('username is required');

  const response = await fetch(KEYS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PROVISIONING_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Shown in the OpenRouter dashboard's activity view, so spend can be
      // traced to an account without keeping a separate mapping.
      name: `forge:${username}`,
      label: `forge:${username}`,
      limit: limitUsd,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Deliberately does not echo the provider payload to the caller: it can
    // contain details about the provisioning account itself.
    console.error('forge provisioning: mint failed', response.status, String(data?.error?.message || '').slice(0, 200));
    throw new Error('Could not activate a Builder Brain right now.');
  }

  const key = data?.key || data?.data?.key;
  if (!key) {
    console.error('forge provisioning: mint returned no key');
    throw new Error('Could not activate a Builder Brain right now.');
  }

  return { key, hash: data?.data?.hash || null, limit: limitUsd };
}

/**
 * Revokes a minted key. Best-effort by design: it is called from cleanup
 * paths where the account is already gone, and a failure here must not block
 * that. An orphaned key is bounded by its own limit, which is the whole point
 * of minting it with one.
 */
export async function revokeCustomerKey(hash) {
  if (!PROVISIONING_KEY || !hash) return false;
  try {
    const response = await fetch(`${KEYS_ENDPOINT}/${encodeURIComponent(hash)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${PROVISIONING_KEY}` },
    });
    return response.ok;
  } catch (error) {
    console.error('forge provisioning: revoke failed', error.message);
    return false;
  }
}
