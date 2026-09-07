// /lib/cleanupAgent.js
// Deterministic, read-only system status service. "Cleaner" does not use an
// LLM, touch source code, alter task ownership, or close/delete anything —
// it only reports concrete signals already available from the Board,
// GitHub, and the Crash Feed, so any agent (or Justin) can see the real
// state of the system without reconstructing it by hand.

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

// Takes open PRs already paired with the files each one touches (fetched
// separately since GitHub's PR list endpoint doesn't include file diffs)
// and flags two real, previously-invisible risk patterns:
//  - file_collisions: two or more open PRs independently editing the same
//    file — exactly how #99 and #103 both rewrote nex-chat-bar.js without
//    either side knowing, discovered only by chance during manual review.
//  - stacked: PRs whose base is not the repo's default branch, since a
//    stacked PR silently depends on another one merging first (or, per
//    GitHub's "merge via async API" restriction, can't use the normal
//    merge button at all) — worth surfacing, not necessarily wrong.
export function analyzePrHealth(pullRequestsWithFiles, defaultBranch) {
  const openPrs = pullRequestsWithFiles.filter((pr) => pr.state === 'open');

  const fileOwners = new Map();
  for (const pr of openPrs) {
    for (const file of pr.files || []) {
      if (!fileOwners.has(file)) fileOwners.set(file, []);
      fileOwners.get(file).push({ number: pr.number, title: pr.title });
    }
  }
  const fileCollisions = [...fileOwners.entries()]
    .filter(([, prs]) => prs.length > 1)
    .map(([file, prs]) => ({ file, prs }));

  const stacked = openPrs
    .filter((pr) => defaultBranch && pr.base && pr.base !== defaultBranch)
    .map((pr) => ({ number: pr.number, title: pr.title, base: pr.base }));

  const draftCount = openPrs.filter((pr) => pr.draft).length;

  return {
    open_count: openPrs.length,
    file_collisions: fileCollisions,
    stacked,
    draft_count: draftCount,
    has_findings: fileCollisions.length > 0 || stacked.length > 0,
  };
}

// Crash Feed already redacts secrets and de-duplicates by fingerprint
// (lib/crashFeed.js) — this just rolls open records into a short summary
// rather than re-implementing any of that.
export function summarizeCrashes(crashes) {
  const open = (crashes || []).filter((crash) => crash.status !== 'resolved');
  const top = [...open]
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
    .slice(0, 5)
    .map((crash) => ({ id: crash.id, title: crash.title, count: crash.count, route: crash.route }));
  return { open_count: open.length, top };
}

export function formatCleanupReport(report) {
  const lines = ['CLEANUP SWEEP — safe review only; no tasks were deleted, closed, or reassigned.'];
  if (report.counts.stale_blocked) lines.push(`• ${report.counts.stale_blocked} blocked task(s) need a fresh decision.`);
  if (report.counts.duplicates) lines.push(`• ${report.counts.duplicates} possible duplicate task(s) need consolidation.`);
  if (report.counts.completion_mismatches) lines.push(`• ${report.counts.completion_mismatches} completed task(s) have an incomplete-work warning.`);
  lines.push('Review the flagged cards; only Nex or Justin should change ownership, status, or delete anything.');
  return lines.join('\n');
}

// The expanded report — board hygiene plus PR health plus crash summary,
// all in one place. This is what makes Cleaner "know what's going on"
// rather than just "know if the board is tidy."
export function formatSystemStatusReport(status) {
  const lines = [formatCleanupReport(status.board)];
  if (status.pr_health.file_collisions.length) {
    lines.push('');
    lines.push('OPEN PR FILE COLLISIONS — two or more open PRs edit the same file independently:');
    for (const collision of status.pr_health.file_collisions) {
      const prList = collision.prs.map((pr) => `#${pr.number} (${pr.title})`).join(' and ');
      lines.push(`• ${collision.file}: ${prList}`);
    }
  }
  if (status.pr_health.stacked.length) {
    lines.push('');
    lines.push('STACKED PRs (base is not the default branch — merge order matters, and the async merge endpoint may be required):');
    for (const pr of status.pr_health.stacked) {
      lines.push(`• #${pr.number} (${pr.title}) → base: ${pr.base}`);
    }
  }
  if (status.crashes.open_count) {
    lines.push('');
    lines.push(`OPEN CRASHES: ${status.crashes.open_count} unresolved Sentry issue(s).`);
    for (const crash of status.crashes.top) {
      lines.push(`• ${crash.title} (seen ${crash.count}x${crash.route ? `, route: ${crash.route}` : ''})`);
    }
  }
  return lines.join('\n');
}

// Builds the full status snapshot. `github` is an object with
// listPullRequests/listPullRequestFiles/getDefaultBranch — passed in
// rather than imported directly so this stays testable with fakes,
// matching the rest of this file's style.
export async function buildSystemStatus({ readBoard, listCrashes, github, owner, repo, now = () => Date.now() }) {
  const [board, defaultBranch, openPrs, crashes] = await Promise.all([
    readBoard(),
    github.getDefaultBranch(owner, repo),
    github.listPullRequests({ owner, repo, state: 'open' }),
    listCrashes ? listCrashes({ limit: 50 }) : Promise.resolve([]),
  ]);

  const prsWithFiles = await Promise.all(
    openPrs.map(async (pr) => ({ ...pr, files: await github.listPullRequestFiles({ owner, repo, pr_number: pr.number }) }))
  );

  const boardReport = analyzeBoardHygiene(board, now());
  const prHealth = analyzePrHealth(prsWithFiles, defaultBranch);
  const crashSummary = summarizeCrashes(crashes);

  const signature = [
    boardReport.signature,
    prHealth.file_collisions.map((c) => `${c.file}:${c.prs.map((p) => p.number).join(',')}`).sort().join('|'),
    prHealth.stacked.map((p) => p.number).sort().join(','),
    String(crashSummary.open_count),
  ].join('::');

  return {
    checked_at: now(),
    board: boardReport,
    pr_health: prHealth,
    crashes: crashSummary,
    has_findings: boardReport.has_findings || prHealth.has_findings || crashSummary.open_count > 0,
    signature,
  };
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
// Passing `github`/`listCrashes` opts a caller into the full status sweep;
// omitting them keeps the original board-only behavior for backward
// compatibility with anything still calling this the old way.
export function createCleanupService({ readBoard, postMessage, github, listCrashes, owner, repo, ledger = createMemoryCleanupLedger(), now = () => Date.now() }) {
  if (!readBoard || !postMessage) throw new Error('readBoard and postMessage are required');

  return {
    async sweep() {
      if (github) {
        const status = await buildSystemStatus({ readBoard, listCrashes, github, owner, repo, now });
        const previous = await ledger.get();
        const changed = status.signature !== previous;

        if (status.has_findings && changed) {
          await postMessage({ from: CLEANER_ID, message: formatSystemStatusReport(status) });
        }
        if (changed) await ledger.set(status.signature);

        return { ...status, posted: status.has_findings && changed };
      }

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
