// api/forge-activate-brain.js
//
// The "Activate my Builder Brain" tap at signup. One click, and the customer
// has a working Brain without leaving Forge, creating a provider account, or
// pasting a key.
//
// This is the endpoint that spends our money, so it is also the one place
// where the gates have to hold:
//
//   - Signed in. Anonymous callers can never mint.
//   - Confirmed email. The account-level cost of a scripted signup run.
//   - Not already connected. Minting is idempotent per account: a double tap,
//     a retry, or a refresh must not produce a second funded key.
//
// The minted key goes straight into encrypted storage and is never returned in
// the response. The customer never sees it, and neither does the model.

import { getRequestUser, isEmailVerified } from '../lib/roomAuth.js';
import { getConnection, saveConnection } from '../lib/forge/brainStore.js';
import { mintCustomerKey, provisioningConfigured } from '../lib/forge/provisioning.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let username;
  try {
    username = await getRequestUser(req);
  } catch (error) {
    console.error('forge-activate-brain: session check failed:', error.message);
    return res.status(500).json({ error: 'Could not check your session.' });
  }
  if (!username) return res.status(401).json({ error: 'Sign in to activate a Builder Brain.' });

  if (!provisioningConfigured()) {
    // Reported as unavailable rather than falling back to any other funding
    // source. "Not switched on yet" must never quietly become "billed to
    // whatever key happens to be configured."
    return res.status(503).json({
      error: 'Instant Brains are not available right now. Connect your own Builder Brain to start building.',
      code: 'PROVISIONING_UNAVAILABLE',
    });
  }

  if (!await isEmailVerified(username).catch(() => false)) {
    return res.status(403).json({
      error: 'Confirm your email first — check your inbox for the link, or resend it from your account.',
      code: 'EMAIL_UNVERIFIED',
    });
  }

  // Idempotency. Checked before minting so a double tap cannot create a second
  // key: the first would be orphaned, still billable, and invisible to us
  // because only the newest hash gets stored.
  try {
    const existing = await getConnection(username);
    if (existing?.connected) {
      return res.status(200).json({
        ok: true,
        alreadyConnected: true,
        funded: Boolean(existing.funded),
        tier: existing.tier || 'free',
      });
    }
  } catch (error) {
    console.error('forge-activate-brain: connection check failed:', error.message);
    return res.status(500).json({ error: 'Could not check your Builder Brain.' });
  }

  try {
    const { key, hash, limit } = await mintCustomerKey(username);
    await saveConnection(username, {
      provider: 'openrouter',
      key,
      tier: 'free',
      funded: true,
      keyHash: hash,
    });
    console.log('forge-activate-brain: minted funded brain', { username, limit });
    return res.status(200).json({ ok: true, funded: true, tier: 'free' });
  } catch (error) {
    // mintCustomerKey already logs the provider detail and throws a message
    // written for a customer.
    console.error('forge-activate-brain: activation failed:', error.message);
    return res.status(502).json({ error: error.message || 'Could not activate a Builder Brain right now.' });
  }
}
