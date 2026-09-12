// api/webhooks/stripe.js
// Verifies and handles Stripe webhook events for Nexus Forge billing.
// Needs the RAW request body to verify Stripe's signature, so
// automatic body parsing is turned off for this route (config export
// below) and the body is read and verified by hand — same reasoning
// as any Stripe webhook handler, adapted to plain Vercel Node
// functions (no framework) like the rest of this repo's api/ routes.

import crypto from 'crypto';
import { setUserPlan } from '../../lib/roomAuth.js';
import { roomMeter } from '../../lib/roomMetering.js';

export const config = {
  api: { bodyParser: false },
};

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 5 * 60;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((piece) => piece.split('='))
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const signatureBuf = Buffer.from(signature, 'hex');
  return expectedBuf.length === signatureBuf.length && crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('stripe webhook: missing STRIPE_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Webhook not configured.' });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];
  if (!verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET)) {
    console.error('stripe webhook: signature verification failed');
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid payload.' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const username = session.metadata?.username || session.client_reference_id;
      const kind = session.metadata?.kind;
      if (!username) {
        console.error('stripe webhook: checkout.session.completed with no username', session.id);
      } else if (kind === 'plan' && session.metadata?.plan) {
        await setUserPlan(username, session.metadata.plan);
      } else if (kind === 'credit_pack') {
        const credits = Number(session.metadata.credits) || 0;
        if (credits > 0) await roomMeter.grantBonusCredits(username, credits);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      // A cancelled subscription should drop the account back to
      // Free, but Stripe only gives us the Customer id here, not the
      // username — checkout.session.completed set metadata on the
      // *session*, and that link isn't persisted anywhere yet. Logged
      // so it's visible rather than silently dropped, until a
      // customer-id-to-username mapping is added (e.g. storing the
      // Stripe customer id on the user record at checkout time).
      console.error('stripe webhook: subscription cancelled, manual downgrade needed', event.data.object.id);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('stripe webhook handling error:', err.message);
    // Stripe retries on non-2xx. Still ack (200) a processed-but-broken
    // event once it's logged, since a retry can't fix things like an
    // unrecognized username — avoids an infinite retry loop for
    // something that needs a human, not a resend.
    return res.status(200).json({ received: true, warning: err.message });
  }
}
