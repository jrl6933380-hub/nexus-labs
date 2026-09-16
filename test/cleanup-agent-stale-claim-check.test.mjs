import test from 'node:test';
import assert from 'node:assert/strict';

const { analyzeBoardHygiene } = await import('../lib/cleanupAgent.js');
const { isClaimCheckStillValid, findClaimMismatch, claimTextForTask } = await import('../lib/claimMismatch.js');

// The exact stored shape of board task 1789189303587-as3ta2, which re-flagged
// on every sweep pass. Its claim_check recorded matched_phrase "not yet wired",
// a string that appears in neither its current result nor its last_note — the
// flag predates the corrected result and was never recomputed.
const REAL_STALE_TASK = {
  id: '1789189303587-as3ta2',
  title: 'Show subscription tiers after Forge signup',
  description:
    'Add a mobile-friendly subscription-tier chooser that appears immediately after a new Nexus Forge account is created. Keep Free as the safe default and do not imply paid checkout exists until billing is wired.',
  status: 'complete',
  owner: 'nex',
  result:
    'Verified complete via direct code read (not sweep heuristic): public/room-login.html has full .tier-modal UI, submitAuth() opens it on signup success, checkout buttons call live /api/checkout with real Stripe price IDs from lib/billingPlans.js. Sweep mismatch was a false positive — no action needed, status stays complete.',
  last_note:
    'Tier chooser is implemented on the work branch. Testing the existing auth/customer journey plus the new signup-only popup and mobile markup before opening a PR.',
  claim_check: { flagged: true, matched_phrase: 'not yet wired', flagged_at: 1789189365261 },
};

test('the real stale task no longer counts as a completion mismatch', () => {
  const report = analyzeBoardHygiene({ tasks: [REAL_STALE_TASK] });
  assert.equal(report.counts.completion_mismatches, 0);
  assert.equal(report.has_findings, false);
  assert.equal(report.findings.length, 0);
});

test('the description is never scanned, even when it contains caveat language', () => {
  // "until billing is wired" lives in the description and must not resurrect
  // the flag — a description is the instruction, not a status claim.
  assert.match(REAL_STALE_TASK.description, /until billing is wired/);
  assert.equal(findClaimMismatch(claimTextForTask(REAL_STALE_TASK)), null);
});

test('a genuinely premature completion is still flagged', () => {
  const task = {
    id: 'real',
    title: 'Execution ledger',
    status: 'complete',
    result: 'Shipped the schema.',
    last_note: 'runtime auto-capture is intentionally not wired yet',
    claim_check: { flagged: true, matched_phrase: 'not wired yet', flagged_at: 1 },
  };
  assert.equal(isClaimCheckStillValid(task), true);
  assert.equal(analyzeBoardHygiene({ tasks: [task] }).counts.completion_mismatches, 1);
});

test('a flag survives when the recorded phrase changed but another phrase still matches', () => {
  const task = {
    id: 'shifted',
    title: 'Half done',
    status: 'complete',
    result: 'Backend done, UI is a placeholder only.',
    claim_check: { flagged: true, matched_phrase: 'not yet built', flagged_at: 1 },
  };
  assert.equal(isClaimCheckStillValid(task), true);
});

test('a legacy flag with no recorded matched_phrase is left alone, not silently dropped', () => {
  const task = { id: 'legacy', title: 'Old flag', claim_check: { flagged: true } };
  assert.equal(isClaimCheckStillValid(task), true);
  assert.equal(analyzeBoardHygiene({ tasks: [task] }).counts.completion_mismatches, 1);
});

test('unflagged tasks are never promoted into a finding', () => {
  const task = { id: 'clean', title: 'Fine', result: 'this one is still pending' };
  assert.equal(isClaimCheckStillValid(task), false);
  assert.equal(analyzeBoardHygiene({ tasks: [task] }).counts.completion_mismatches, 0);
});

test('revalidation does not mutate the task it inspects', () => {
  const snapshot = JSON.stringify(REAL_STALE_TASK);
  analyzeBoardHygiene({ tasks: [REAL_STALE_TASK] });
  assert.equal(JSON.stringify(REAL_STALE_TASK), snapshot);
});
