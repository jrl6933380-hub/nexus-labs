import test from 'node:test';
import assert from 'node:assert/strict';

const {
  analyzeBoardHygiene,
  analyzePrHealth,
  summarizeCrashes,
  buildSystemStatus,
  formatSystemStatusReport,
  createCleanupService,
} = await import('../lib/cleanupAgent.js');

test('Cleaner reports only concrete board integrity signals (unchanged behavior)', () => {
  const report = analyzeBoardHygiene({
    tasks: [
      { id: 'old', title: 'Old blocker', stale_check: { flagged: true } },
      { id: 'dupe', title: 'Duplicate', duplicate_check: { flagged: true } },
      { id: 'claim', title: 'Premature complete', claim_check: { flagged: true } },
      { id: 'clean', title: 'Fine' },
    ],
  }, 123);

  assert.deepEqual(report.counts, { stale_blocked: 1, duplicates: 1, completion_mismatches: 1 });
  assert.equal(report.findings.length, 3);
});

test('analyzePrHealth flags two open PRs editing the same file', () => {
  const prs = [
    { number: 99, title: 'Dock v1', state: 'open', draft: false, base: 'main', files: ['public/nex-chat-bar.js'] },
    { number: 103, title: 'Visual Space homepage', state: 'open', draft: false, base: 'main', files: ['public/nex-chat-bar.js', 'public/index.html'] },
    { number: 50, title: 'Unrelated', state: 'open', draft: false, base: 'main', files: ['public/tenants.html'] },
  ];
  const health = analyzePrHealth(prs, 'main');
  assert.equal(health.file_collisions.length, 1);
  assert.equal(health.file_collisions[0].file, 'public/nex-chat-bar.js');
  assert.deepEqual(health.file_collisions[0].prs.map((p) => p.number).sort((a, b) => a - b), [99, 103]);
  assert.equal(health.has_findings, true);
});

test('analyzePrHealth flags stacked PRs (base is not the default branch)', () => {
  const prs = [
    { number: 104, title: 'a11y fix', state: 'open', draft: true, base: 'fix/visual-space-homepage', files: [] },
    { number: 103, title: 'homepage', state: 'open', draft: false, base: 'main', files: [] },
  ];
  const health = analyzePrHealth(prs, 'main');
  assert.equal(health.stacked.length, 1);
  assert.equal(health.stacked[0].number, 104);
  assert.equal(health.draft_count, 1);
  assert.equal(health.has_findings, true);
});

test('analyzePrHealth finds nothing wrong when PRs do not overlap and all target main', () => {
  const prs = [
    { number: 1, title: 'a', state: 'open', draft: false, base: 'main', files: ['a.js'] },
    { number: 2, title: 'b', state: 'open', draft: false, base: 'main', files: ['b.js'] },
  ];
  const health = analyzePrHealth(prs, 'main');
  assert.equal(health.has_findings, false);
  assert.equal(health.file_collisions.length, 0);
  assert.equal(health.stacked.length, 0);
});

test('summarizeCrashes counts unresolved and ranks by recurrence', () => {
  const crashes = [
    { id: 'a', title: 'A', count: 2, status: 'open' },
    { id: 'b', title: 'B', count: 9, status: 'open' },
    { id: 'c', title: 'C', count: 5, status: 'resolved' },
  ];
  const summary = summarizeCrashes(crashes);
  assert.equal(summary.open_count, 2);
  assert.equal(summary.top[0].id, 'b');
});

test('buildSystemStatus combines board + PR + crash signals into one status with a stable signature', async () => {
  const board = { tasks: [] };
  const fakeGithub = {
    getDefaultBranch: async () => 'main',
    listPullRequests: async () => ([
      { number: 99, title: 'Dock', state: 'open', draft: false, base: 'main' },
      { number: 103, title: 'Homepage', state: 'open', draft: false, base: 'main' },
    ]),
    listPullRequestFiles: async ({ pr_number }) =>
      pr_number === 99 ? ['public/nex-chat-bar.js'] : ['public/nex-chat-bar.js', 'public/index.html'],
  };
  const status = await buildSystemStatus({
    readBoard: async () => board,
    listCrashes: async () => [],
    github: fakeGithub,
    owner: 'jrl6933380-hub',
    repo: 'nexus-labs',
    now: () => 999,
  });

  assert.equal(status.has_findings, true);
  assert.equal(status.pr_health.file_collisions.length, 1);
  assert.equal(typeof status.signature, 'string');

  const report = formatSystemStatusReport(status);
  assert.match(report, /OPEN PR FILE COLLISIONS/);
  assert.match(report, /public\/nex-chat-bar\.js/);
});

test('createCleanupService with github passed in posts the expanded report once per change, never mutates anything', async () => {
  const board = { tasks: [] };
  const posted = [];
  const fakeGithub = {
    getDefaultBranch: async () => 'main',
    listPullRequests: async () => ([{ number: 1, title: 'X', state: 'open', draft: false, base: 'main' }]),
    listPullRequestFiles: async () => ['a.js'],
  };
  const cleaner = createCleanupService({
    readBoard: async () => board,
    postMessage: async (m) => posted.push(m),
    github: fakeGithub,
    listCrashes: async () => [{ id: 'x', title: 'Crash', count: 4, status: 'open' }],
    owner: 'o', repo: 'r',
    now: () => 1,
  });

  const first = await cleaner.sweep();
  const second = await cleaner.sweep();

  assert.equal(first.posted, true);
  assert.equal(second.posted, false);
  assert.equal(posted.length, 1);
  assert.match(posted[0].message, /OPEN CRASHES/);
});

test('createCleanupService without github falls back to board-only behavior (backward compatible)', async () => {
  const board = { tasks: [{ id: 'old', title: 'Old blocker', stale_check: { flagged: true } }] };
  const posted = [];
  const cleaner = createCleanupService({
    readBoard: async () => board,
    postMessage: async (m) => posted.push(m),
    now: () => 1,
  });
  const result = await cleaner.sweep();
  assert.equal(result.posted, true);
  assert.equal(posted[0].message.startsWith('CLEANUP SWEEP'), true);
});
