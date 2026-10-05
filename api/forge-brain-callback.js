// api/forge-brain-callback.js
//
// Where the provider sends the user back after they authorize.
//
// This route is the security boundary of the whole flow, so it is deliberately
// strict:
//
//   - The `state` must match a pending authorization we created. Unknown,
//     expired, or already-used state is rejected. consumePendingAuthorization
//     deletes on read, so a replayed callback cannot mint a second key.
//   - The pending record carries the username. The callback does NOT trust any
//     identity from the query string, and it re-checks the session, so a
//     callback opened in someone else's browser cannot attach a key to their
//     account.
//   - The code-for-key exchange happens here, server-side. The minted key is
//     encrypted before storage and never reaches the browser — which is the one
//     place this deliberately differs from the provider's own reference
//     implementation.
//
// The user is redirected back into Forge either way. A dead screen at the end
// of an OAuth bounce is the worst possible outcome: they have already given
// consent and have nothing to show for it.

import { getRequestUser } from '../lib/roomAuth.js';
import { consumePendingAuthorization, saveConnection } from '../lib/forge/brainStore.js';
import { getAdapter } from '../lib/forge/brainProviders.js';

function back(res, params, pending) {
  // Every branch below logs its reason. An earlier version redirected silently
  // on the expired/rejected paths, so a broken connection looked identical to
  // a working one from the logs — the 302 was there, the error was not.
  // Reasons only, never the code, the state, or any provider payload.
  console.log('forge-brain-callback:', params.brain);
  const query = new URLSearchParams(params).toString();
  const destination = pending?.returnTo === 'login' ? '/room-login.html' : '/forge.html';
  res.setHeader('Location', `${destination}?${query}`);
  return res.status(302).end();
}

export default async function handler(req, res) {
  const { code, state, error: providerError } = req.query || {};

  if (!state) return back(res, { brain: providerError ? 'cancelled' : 'unknown' });

  let pending;
  try {
    pending = await consumePendingAuthorization(String(state));
  } catch {
    return back(res, { brain: 'network' });
  }
  // No pending record means expired, already used, or forged.
  if (!pending) return back(res, { brain: 'expired' });
  if (providerError) return back(res, { brain: 'cancelled' }, pending);

  // Re-check the session and require it to be the same user who started this.
  let username;
  try {
    username = await getRequestUser(req);
  } catch {
    username = null;
  }
  if (!username || username !== pending.username) {
    console.log('forge-brain-callback: session did not match the account that started this');
    return back(res, { brain: 'rejected' }, pending);
  }

  if (!code) return back(res, { brain: 'rejected' }, pending);

  try {
    const adapter = getAdapter(pending.provider || 'openrouter');
    const { key } = await adapter.exchangeCode({
      code: String(code),
      codeVerifier: pending.codeVerifier,
    });
    await saveConnection(username, { provider: adapter.id, key, tier: pending.tier || 'free' });
    return back(res, { brain: 'connected' }, pending);
  } catch (error) {
    // Log the shape of the failure, never the code or any response body that
    // might carry fragments of the exchange.
    console.error('forge-brain-callback: exchange failed:', error.message);
    return back(res, { brain: 'test_failed' }, pending);
  }
}
