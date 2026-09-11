// lib/nexLanes.js
// Two working lanes for Nex — "chat" and "code" — each with a crew of
// specialist roles behind it instead of one model doing everything.
//
// WHY LANES AND NOT JUST A BIGGER MODEL
// The complaint this exists to fix is "Nex gets confused and doesn't know
// what files I'm talking about." That is not primarily a model-strength
// problem. A stronger model that still answers from memory is confidently
// wrong more fluently. What makes an agent feel like it "just knows" is
// that it LOOKS FIRST — searches the repo, reads the actual file — before
// forming an opinion. So every lane here starts with a grounding step that
// is mandatory, not advisory.
//
// WHY A REVIEWER
// The code lane's most important role is the one that produces no code.
// On 2026-09-11 a change reached a PR that deleted 1,314 working lines of
// public/room.html; it was caught by review, not by the author. Every
// failure that night was unverified work moving forward, not a weak model.
// A crew without an independent check is just a faster way to be wrong.

import { routeToModel } from './modelRouter.js';

// Per-role model assignments. Every one is env-overridable
// (NEX_ROLE_<ROLE>_MODEL) so a model can be swapped without a deploy.
//
// Roles that judge are deliberately NOT the same model as the role they
// judge: an implementer reviewing its own diff tends to re-derive the same
// blind spot and call it agreement. Cross-family review is the point.
const DEFAULT_ROLE_MODELS = {
  // Fast orientation: "which files matter here?" — high volume, low stakes.
  scout: 'google/gemini-2.5-flash',
  // Conversation and explanation.
  responder: 'anthropic/claude-sonnet-4.5',
  // Planning a change: reads real files, names exact edits.
  architect: 'anthropic/claude-sonnet-4.5',
  // Writing the edits.
  implementer: 'anthropic/claude-sonnet-4.5',
  // Independent check. Different family from implementer on purpose.
  reviewer: 'openai/gpt-5.6-sol',
};

export function modelForRole(role, env = process.env) {
  const key = `NEX_ROLE_${String(role || '').toUpperCase()}_MODEL`;
  return env[key] || DEFAULT_ROLE_MODELS[role] || DEFAULT_ROLE_MODELS.responder;
}

export const LANES = Object.freeze({
  chat: {
    id: 'chat',
    label: 'Chat',
    // Talking, explaining, deciding. No repo writes from this lane — if a
    // chat turn concludes that code must change, it hands to the code lane
    // rather than quietly editing, so every write goes through review.
    crew: ['scout', 'responder'],
    canWrite: false,
    tier: 'standard',
  },
  code: {
    id: 'code',
    label: 'Code',
    // Ordered pipeline, not parallel clones. Each stage consumes the
    // previous stage's real output.
    crew: ['scout', 'architect', 'implementer', 'reviewer'],
    canWrite: true,
    tier: 'heavy',
  },
});

export function laneFor(id) {
  const lane = LANES[String(id || '').toLowerCase()];
  if (!lane) {
    throw new Error(`Unknown lane "${id}". Expected "chat" or "code".`);
  }
  return lane;
}

// The grounding contract, injected ahead of every lane's work.
//
// Written as a hard prohibition rather than a suggestion because the
// failure mode is specifically confident recall: the model believes it
// remembers the file and answers without checking. "Prefer to look things
// up" does not beat that; "you have not been shown this file" does.
export const GROUNDING_CONTRACT = [
  'Before answering anything about this codebase, you must look at it.',
  'You have NOT been shown any file in this repository. Anything you believe you remember about its contents is unverified and may be from a different project or an older version.',
  'Use search_code and list_files to locate the real file, then get_file to read the part you intend to discuss or change.',
  'If you have not read a file in THIS session, do not describe its contents, do not claim what it currently does, and do not edit it.',
  'When you are unsure which file the user means, name your best candidates and say what you checked — do not silently pick one.',
  'Quote the actual line or function you are referring to, so the user can see you are looking at the real thing.',
].join('\n');

// Extra constraints for the writing stage. patch_repo_file exists precisely
// so a large file can be edited without reproducing it; saying so here is
// what actually changes behavior, since the model otherwise reaches for the
// more familiar whole-file write.
export const WRITE_CONTRACT = [
  'Use patch_repo_file for edits to any file that already exists. Send only the exact snippet to replace.',
  'Do NOT use update_file on a file you have not read end to end in this session. Rewriting a large file from a partial read is how 1,314 working lines of public/room.html were deleted.',
  'Work on a branch. Never commit directly to main.',
  'After writing, read the file back and confirm the line count changed by roughly what you intended. A large unexpected drop means you destroyed something.',
  'Run the test suite in the sandbox and report the real output. Do not claim tests pass without running them.',
].join('\n');

export function contractFor(laneId) {
  const lane = laneFor(laneId);
  return lane.canWrite
    ? `${GROUNDING_CONTRACT}\n\n${WRITE_CONTRACT}`
    : GROUNDING_CONTRACT;
}

/**
 * Run one crew role as a discrete delegated call.
 *
 * Deliberately NOT wrapped in a fallback chain: if the reviewer's model is
 * unavailable, the correct behavior is to fail loudly and block the write,
 * not to quietly substitute a weaker model and still report "reviewed."
 * A review that silently degraded is worse than no review, because it
 * carries the same authority.
 */
export async function runRole({
  role,
  system,
  messages,
  max_tokens = 4096,
  env = process.env,
  fetchFn = fetch,
  routeFn = routeToModel,
}) {
  if (!role) throw new Error('runRole requires a role.');
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error(`runRole(${role}) requires at least one message.`);
  }
  const model = modelForRole(role, env);
  const result = await routeFn({
    model,
    body: {
      max_tokens,
      ...(system ? { system } : {}),
      messages,
    },
    env,
    fetchFn,
  });
  return { role, model, data: result.data };
}

// Verdict parsing for the reviewer stage.
//
// Fails CLOSED: anything that isn't an unambiguous approval is treated as a
// block. An unparseable review must not read as consent — that would make
// a malformed response the easiest possible way to bypass the check.
export function parseReviewVerdict(text) {
  const raw = String(text || '');
  const normalized = raw.toUpperCase();
  const approved = /\bVERDICT\s*:\s*APPROVE\b/.test(normalized);
  const blocked = /\bVERDICT\s*:\s*BLOCK\b/.test(normalized);

  if (approved && !blocked) {
    return { verdict: 'approve', blocking: false, reason: raw.trim() };
  }
  if (blocked) {
    return { verdict: 'block', blocking: true, reason: raw.trim() };
  }
  return {
    verdict: 'unclear',
    blocking: true,
    reason: raw.trim() || 'Reviewer returned no usable verdict.',
  };
}

export const REVIEWER_SYSTEM = [
  'You are reviewing a proposed code change before it becomes a pull request.',
  'You did not write this change. Your job is to find what is wrong with it, not to agree with it.',
  '',
  'Block the change if any of these are true:',
  '- It deletes code with no stated reason, or the line count drops far more than the description implies.',
  '- It claims tests pass but includes no actual test output.',
  '- It rewrites a whole file when a targeted edit would do.',
  '- It changes behavior the request did not ask for.',
  '- It describes a file it clearly has not read.',
  '',
  'End your reply with exactly one line:',
  'VERDICT: APPROVE',
  'or',
  'VERDICT: BLOCK',
  '',
  'If you are unsure, BLOCK and say what you would need to see. An unclear review is treated as a block.',
].join('\n');
