// lib/forgePayouts.js
// Sends newly recorded commission to callers through Stripe Connect.
// A caller without a connected account (or one Stripe won't pay yet)
// simply keeps the row as 'pending' -- nothing is lost, it shows as
// "owed" and can be paid once they finish payout setup.

import { transferCommission } from './forgeStripe.js';
import { markCommission } from './forgeDb.js';

export async function payCommissionEvents(events, { chargeId, clientId }) {
  const results = [];
  for (const { event, caller } of events) {
    if (!caller?.stripe_connect_account_id) {
      results.push({ id: event.id, status: 'pending', reason: 'caller has not set up payouts' });
      continue;
    }
    try {
      const transferId = await transferCommission({
        eventId: event.id,
        amountCents: Math.round(Number(event.amount) * 100),
        destination: caller.stripe_connect_account_id,
        chargeId,
        clientId,
      });
      await markCommission(event.id, { status: 'paid', transferId });
      results.push({ id: event.id, status: 'paid', transferId });
    } catch (err) {
      // Leave it pending so it can be retried; never mark money as paid
      // unless Stripe actually accepted the transfer.
      console.error('forgePayouts: transfer failed for', event.id, err.message);
      results.push({ id: event.id, status: 'pending', reason: err.message });
    }
  }
  return results;
}
