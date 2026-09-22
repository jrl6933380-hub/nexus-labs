// api/forge-usage.js
//
// What the customer has left, expressed as a proportion.
//
// Deliberately does NOT return credit counts. "You have 43 credits" asks
// someone to learn an invented unit and then do arithmetic in it before they
// know whether they can build one more page. A ring that is two-thirds full
// answers the only question they actually have — is there room to keep going —
// without teaching them anything first.
//
// It also keeps the internal unit internal. Credit costs per build are tuning
// numbers; publishing them invites customers to optimise against a scale we
// expect to change, and turns any future rebalance into a visible price rise.
//
// The reset time IS returned, because "it refills tomorrow" is the piece that
// turns an empty ring from a dead end into a wait.

import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';
import { createRoomMeter } from '../lib/roomMetering.js';

let sharedMeter = null;
function meter() {
  if (!sharedMeter) sharedMeter = createRoomMeter();
  return sharedMeter;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let username;
  try {
    username = await getRequestUser(req);
  } catch (error) {
    console.error('forge-usage: session check failed:', error.message);
    return res.status(500).json({ error: 'Could not check your session.' });
  }
  if (!username) return res.status(401).json({ error: 'Not signed in' });

  // Operators are exempt from metering, so there is no meaningful fraction to
  // show them — an unlimited ring would just be a full circle that never moves.
  if (isOperatorUser(username)) {
    return res.status(200).json({ unlimited: true });
  }

  try {
    const daily = await meter().getDailyUsageSummary(username);
    const percentRemaining = daily?.unlimited
      ? 100
      : Math.max(0, Math.min(100, Number(daily?.percentRemaining ?? 100)));
    return res.status(200).json({
      unlimited: Boolean(daily?.unlimited),
      percentRemaining,
      // Millisecond timestamp; the client renders it relatively ("refills in
      // 4 hours") so the copy stays right regardless of time zone.
      resetAt: daily?.resetAt ?? null,
      empty: percentRemaining <= 0,
    });
  } catch (error) {
    // A usage read failing must not break the page it decorates. Reporting
    // "unknown" lets the client simply omit the ring rather than render a
    // misleading full or empty one.
    console.error('forge-usage: read failed:', error.message);
    return res.status(200).json({ unknown: true });
  }
}
