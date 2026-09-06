// /lib/cleanupAgent.js
// Deterministic, read-only board housekeeping. Cleaner does not use an LLM,
// touch source code, alter task ownership, or close work. It reports only
// concrete integrity signals already attached by the Board.

const CLEANER_ID = 'cleaner';

export function analyzeBoardHygiene(board, now = Date.now()) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const flagged = {
    stale_blocked: tasks.filter((task) => task.stale_check?.flagged),
    duplicates: tasks.filter((task) => task.duplicate_check?.flagged),
    completion_mismatches: tasks.filter((task) => task.claim_check?.flagged),
  };

  const findings = Object.entries(flagged).flatMap(([kind, items]) =>
    items.map((task) => ({ kind, task_id: task.id, title: task.title }))
  );
  const signature = findings
    .map((finding) => `${finding.kind}:${finding.task_id}`)
    .sort()
    .join('|');

  return {
    agent_id: CLEANER_ID,
    checked_at: now,
    findings,
    counts: Object.fromEntries(Object.entries(flagged).map(([kind, items]) => [kind, items.length])),
    has_findings: findings.length > 0,
    signature,
  };
}

export function formatCleanupReport(report) {
  const lines = ['CLEANUP SWEEP — safe review only; no tasks were deleted, closed, or reassigned.'];
  if (report.counts.stale_blocked) lines.push(`• ${report.counts.stale_blocked} blocked task(s) need a fresh decision.`);
  if (report.counts.duplicates) lines.push(`• ${report.counts.duplicates} possible duplicate task(s) need consolidation.`);
  if (report.counts.completion_mismatches) lines.push(`• ${report.counts.completion_mismatches} completed task(s) have an incomplete-work warning.`);
  lines.push('Review the flagged cards; only Nex or Justin should change ownership, status, or delete anything.');
  return lines.join('\n');
}

export function createMemoryCleanupLedger() {
  let signature = null;
  return {
    async get() { return signature; },
    async set(value) { signature = value; },
  };
}

// A sweep posts one concise report only when the active findings change,
// which keeps the Board clean instead of adding the same warning every run.
export function createCleanupService({ readBoard, postMessage, ledger = createMemoryCleanupLedger(), now = () => Date.now() }) {
  if (!readBoard || !postMessage) throw new Error('readBoard and postMessage are required');

  return {
    async sweep() {
      const report = analyzeBoardHygiene(await readBoard(), now());
      const previous = await ledger.get();
      const changed = report.signature !== previous;

      if (report.has_findings && changed) {
        await postMessage({ from: CLEANER_ID, message: formatCleanupReport(report) });
      }
      if (changed) await ledger.set(report.signature);

      return { ...report, posted: report.has_findings && changed };
    },
  };
}
