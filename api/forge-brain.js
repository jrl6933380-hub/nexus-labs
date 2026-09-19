// api/forge-brain.js
//
// Builder Brain status and actions for the signed-in Forge user.
//
// Hard rule for every branch in this file: no provider key, encrypted or not,
// appears in any response body, error message, or log line. The store's
// getConnection() strips the secret for exactly this reason, and the only
// function that can produce a raw key (getProviderKey) is never called here
// except to hand straight to the provider adapter.
//
// Every handler resolves the username from the session cookie. There is no
// parameter anywhere that lets a caller name a different user — that is what
// keeps one customer's brain out of another customer's reach.

import { getRequestUser } from '../lib/roomAuth.js';
import {
  getConnection,
  getProviderKey,
  markTested,
  setTier,
  disconnect,
  savePendingAuthorization,
} from '../lib/forge/brainStore.js';
import { getAdapter, listAdapters } from '../lib/forge/brainProviders.js';
import { deriveState, describe, RECOVERY } from '../lib/forge/onboardingMachine.js';

function callbackUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/api/forge-brain-callback`;
}

export default async function handler(req, res) {
  let username;
  try {
    username = await getRequestUser(req);
  } catch {
    return res.status(500).json({ error: 'Could not check your session.' });
  }
  if (!username) return res.status(401).json({ error: 'Not signed in' });

  const adapter = getAdapter('openrouter');

  if (req.method === 'GET') {
    try {
      const connection = await getConnection(username);
      const state = deriveState({
        hasAccount: true,
        acceptedTerms: true,
        hasConnection: Boolean(connection?.connected),
        connectionTested: Boolean(connection?.tested_at),
      });
      return res.status(200).json({
        connected: Boolean(connection?.connected),
        provider: connection?.provider || null,
        tier: connection?.tier || null,
        tested_at: connection?.tested_at || null,
        connected_at: connection?.connected_at || null,
        usage: connection?.usage ?? null,
        limit: connection?.limit ?? null,
        state,
        step: describe(state, { tiers: adapter.tiers }),
        providers: listAdapters(),
      });
    } catch (error) {
      // A missing FORGE_ENCRYPTION_KEY lands here. Say so honestly rather than
      // pretending there is no connection — an operator needs to be able to
      // tell "not set up" from "misconfigured".
      return res.status(500).json({ error: 'Could not read your Builder Brain.', detail: error.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, tier } = req.body || {};

  try {
    if (action === 'authorize') {
      const { redirectUrl, state, codeVerifier } = adapter.beginAuthorization({
        callbackUrl: callbackUrl(req),
      });
      await savePendingAuthorization(username, {
        state, codeVerifier, provider: adapter.id, tier: tier || 'free',
      });
      // Only the redirect URL crosses to the browser. The verifier stays here.
      return res.status(200).json({ redirectUrl });
    }

    if (action === 'test') {
      const key = await getProviderKey(username);
      if (!key) return res.status(400).json({ error: 'No Builder Brain connected yet.', recovery: RECOVERY.unknown });
      const result = await adapter.testConnection(key);
      if (!result.ok) {
        return res.status(200).json({ ok: false, message: result.label, recovery: RECOVERY.test_failed });
      }
      await markTested(username, { usage: result.usage, limit: result.limit, free: result.free });
      return res.status(200).json({ ok: true, message: result.label, usage: result.usage, limit: result.limit });
    }

    if (action === 'set_tier') {
      const valid = adapter.tiers.some((t) => t.id === tier);
      if (!valid) return res.status(400).json({ error: 'Unknown option.' });
      const saved = await setTier(username, tier);
      if (!saved) return res.status(400).json({ error: 'No Builder Brain connected yet.' });
      return res.status(200).json({ ok: true, tier: saved });
    }

    if (action === 'disconnect') {
      await disconnect(username);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('forge-brain:', error.message);
    return res.status(500).json({ error: 'Something went wrong.', recovery: RECOVERY.unknown });
  }
}
