// /lib/systemMonitor.js
// Turns get_system_status from something you have to ask for into
// something that's already been checked by the time you look.
//
// Piggybacks on the existing /api/board poll (already hit every ~4s by
// every open canvas) instead of a new Vercel cron — Hobby-plan cron
// frequency can't get anywhere near real-time anyway, and the daily
// /api/cleanup sweep is too slow to matter for "catch it before a
// customer hits it." Throttled so the actual GitHub/board checks only
// run a few times a minute at most, not on every single poll, and
// never blocks the board response — a check runs in the background;
// the poll that triggered it gets whatever status was already known,
// and the fresh result shows up on the next poll or two.
//
// Reuses lib/cleanupAgent.js's createCleanupService as-is: it already
// posts one deduped board message (from "cleaner") only when the
// findings signature actually changes, so this doesn't spam the board
// just because it's checking more often now.

import { createCleanupService } from './cleanupAgent.js';
import { readBoard, postMessage } from './board.js';
import { listCrashes } from './crashFeed.js';
import { getDefaultBranch, listPullRequests, listPullRequestFiles } from './github.js';

const DEFAULT_INTERVAL_MS = 3 * 60 * 1000; // at most once every 3 minutes

// Factory so this is testable with a fake `sweep` — the exported
// singleton below wires it to the real cleanup service for actual use.
export function createSystemMonitor({ sweep, intervalMs = DEFAULT_INTERVAL_MS, now = () => Date.now() }) {
  if (!sweep) throw new Error('sweep is required');

  let lastCheckedAt = 0;
  let lastStatus = null;
  let inFlight = null;

  return {
    // Call this on every board poll. Returns immediately with whatever
    // status is already known (possibly null, possibly stale) — never
    // awaits the actual check. Fires a background sweep only if one
    // isn't already running and the throttle window has elapsed.
    maybeCheck() {
      const current = now();
      if (inFlight || (current - lastCheckedAt) < intervalMs) return lastStatus;

      lastCheckedAt = current;
      inFlight = sweep()
        .then((status) => { lastStatus = status; return status; })
        .catch((err) => {
          // A failed check (GitHub hiccup, etc.) never breaks the board
          // poll it rode in on — just keep the last known status and
          // try again next window.
          console.error('systemMonitor sweep failed:', err.message);
          return lastStatus;
        })
        .finally(() => { inFlight = null; });

      return lastStatus;
    },
    getLast() {
      return lastStatus;
    },
  };
}

const cleanupService = createCleanupService({
  readBoard,
  postMessage,
  github: { getDefaultBranch, listPullRequests, listPullRequestFiles },
  listCrashes,
  owner: process.env.NEXUS_REPO_OWNER || 'jrl6933380-hub',
  repo: process.env.NEXUS_REPO_NAME || 'nexus-labs',
});

const defaultMonitor = createSystemMonitor({ sweep: () => cleanupService.sweep() });

export function maybeCheckSystemStatus() {
  return defaultMonitor.maybeCheck();
}

export function getLastSystemStatus() {
  return defaultMonitor.getLast();
}
