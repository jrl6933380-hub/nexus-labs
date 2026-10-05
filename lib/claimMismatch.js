// /lib/claimMismatch.js
// Pure, dependency-free home for the completion-mismatch rule.
//
// This logic used to live privately inside lib/board.js, which meant only
// the code that SET a claim_check flag could evaluate the rule. The cleanup
// sweep (lib/cleanupAgent.js) could only read the stored boolean and had no
// way to ask "is this flag still true?" — so a flag computed once, at
// completion time, was reported forever even after the task's result was
// corrected.
//
// Kept free of imports/side effects on purpose: lib/board.js talks to KV,
// and lib/cleanupAgent.js is deliberately testable with plain fakes. Neither
// should have to pull in the other just to share a string list.

// Phrases that, if present in a task's own text at the moment it's marked
// complete, usually mean the completion is premature — the agent's own words
// are admitting the work isn't actually finished. Non-blocking by design:
// this never prevents a completion, it only attaches a visible flag.
export const CLAIM_MISMATCH_PHRASES = [
  'not wired yet',
  'not yet wired',
  'not started',
  'not yet implemented',
  'not implemented yet',
  'not yet built',
  'not built yet',
  'todo',
  'to-do',
  'pending',
  'placeholder only',
  'still needs',
  'no runtime',
  'not runtime-complete',
  'not live yet',
  'not yet live',
];

export function findClaimMismatch(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  return CLAIM_MISMATCH_PHRASES.find((phrase) => lower.includes(phrase)) || null;
}

// The exact text a completion claim is judged against: the task's own result
// and its most recent progress note.
//
// Deliberately NOT the description. A description is the instruction written
// before the work started ("do not imply paid checkout exists until billing
// is wired") and will often contain caveat language that says nothing about
// whether the work got finished. Scanning it would flag correctly-completed
// tasks forever, with no way for a result to clear them.
export function claimTextForTask(task) {
  return [task?.result, task?.last_note].filter(Boolean).join(' \n ');
}

// Is a task's STORED claim_check flag still supported by its CURRENT text?
//
// Conservative on purpose — it only drops a flag it can positively prove is
// stale:
//  - current text still matches some phrase        -> still flagged
//  - a matched_phrase was recorded and that phrase is gone from the current
//    text, and nothing else matches                -> stale, drop it
//  - flag with no recorded matched_phrase          -> left alone, since there
//    is nothing to verify against and guessing would hide a real warning
//
// Read-only: it inspects, it never mutates the task.
export function isClaimCheckStillValid(task) {
  if (!task?.claim_check?.flagged) return false;
  if (findClaimMismatch(claimTextForTask(task))) return true;
  if (task.claim_check.matched_phrase) return false;
  return true;
}
