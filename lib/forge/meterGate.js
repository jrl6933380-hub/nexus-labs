// lib/forge/meterGate.js
//
// The choke point every model call passes through.
//
// Forge now funds all inference. There is no bring-your-own-key path left, so
// there is no request that costs us nothing — which means there is no longer
// any such thing as a request that may legitimately skip the meter.
//
// That is a sharper requirement than it sounds. Metering used to live in the
// API routes, and when Forge moved to customer-powered builds it was removed
// from them (#366, #367) because customers were paying their own provider.
// Nothing was wrong with that at the time. But it left `createRoomMeter` wired
// to no route at all, so re-funding inference without re-wiring it would have
// meant every build spending real money with no daily cap, no platform
// ceiling, and no record.
//
// So the gate does not live in the routes. It lives here, and
// lib/forge/brainStream.js calls it immediately before every fetch to a model
// provider. A new route cannot forget to meter, because a new route does not
// get to make the call itself.
//
// Failure direction is deliberate throughout: when something goes wrong we
// over-count or refuse, never under-count. Specifically:
//
//   - A reservation that is never settled expires on its TTL and is released.
//     Forgetting to settle costs the customer headroom for a few minutes. It
//     never costs us an unrecorded model call.
//   - If Redis is unreachable, the call is REFUSED rather than allowed
//     through. An outage that makes spending unobservable is exactly when
//     spending should stop.
//   - Operator accounts are exempt, because the operator's usage is our own
//     and metering it would only distort the customer signal.

import { createRoomMeter } from '../roomMetering.js';
import { isOperatorUser } from '../roomAuth.js';

let sharedMeter = null;
function defaultMeter() {
  if (!sharedMeter) sharedMeter = createRoomMeter();
  return sharedMeter;
}

/** Maps a metering refusal to copy a customer can act on. */
export function meterRefusalMessage(reason) {
  if (reason === 'daily_budget_exhausted') {
    return "You've used today's building. It refills tomorrow, or you can upgrade for more.";
  }
  if (reason === 'budget_exhausted') {
    return "You've used this month's building. Upgrade to keep going.";
  }
  if (reason === 'global_ceiling_exceeded') {
    return 'Forge is unusually busy right now. Try again in a few minutes.';
  }
  if (reason === 'meter_unavailable') {
    return 'Forge can\u2019t start a build right now. Try again in a moment.';
  }
  return 'You\u2019ve used your available building for now.';
}

export class MeterRefusedError extends Error {
  constructor(reason) {
    super(meterRefusalMessage(reason));
    this.name = 'MeterRefusedError';
    this.code = 'METER_REFUSED';
    this.reason = reason;
  }
}

/**
 * Reserves budget for one model call and returns a settle handle.
 *
 * Throws MeterRefusedError when the call must not proceed. Callers should let
 * that propagate: the error message is already written for a customer.
 *
 * The returned settle() is safe to call more than once and safe never to call
 * — it is best-effort by design, because a settle failure must not turn a
 * successful build into an error the customer sees. An unsettled reservation
 * simply expires.
 */
export async function reserveModelCall({
  username,
  kind = 'fresh',
  requestId,
  meter = defaultMeter(),
  isOperator = isOperatorUser,
} = {}) {
  // No username means no account to charge. With BYOK gone there is no
  // anonymous path that costs nothing, so this refuses rather than allowing an
  // untracked call.
  if (!username) throw new MeterRefusedError('meter_unavailable');

  if (isOperator(username)) {
    return { exempt: true, settle: async () => {} };
  }

  let reservation;
  try {
    reservation = await meter.reserveBuild({ userId: username, kind, requestId, isFreeTier: true });
  } catch (error) {
    // Refuse, don't allow. If we cannot record spend, we do not spend.
    console.error('meterGate: reservation failed, refusing call:', error.message);
    throw new MeterRefusedError('meter_unavailable');
  }

  if (!reservation?.ok) {
    throw new MeterRefusedError(reservation?.reason || 'budget_exhausted');
  }

  let settled = false;
  return {
    exempt: false,
    reservationId: reservation.reservationId,
    period: reservation.period,
    async settle({ success = true, chargedCredits } = {}) {
      if (settled) return;
      settled = true;
      try {
        await meter.settleBuild({
          userId: username,
          period: reservation.period,
          reservationId: reservation.reservationId,
          success,
          chargedCredits,
        });
      } catch (error) {
        // The reservation will expire on its own TTL, so the budget is not
        // permanently lost. Never surfaced to the customer.
        console.error('meterGate: settlement failed (reservation will expire):', error.message);
      }
    },
  };
}
