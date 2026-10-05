// /lib/hyperfocusTriggers.js
// Deterministic recognition of the five fixed Hyperfocus trigger
// phrases from the task spec — regex-based, not model judgment, so
// these always fire regardless of which tier/model happens to answer
// a given turn. Mirrors lib/claudeHandoff.js's DISENGAGE_PATTERN
// style, but these are natural-language phrases rather than a single
// literal command word, so matching uses word-boundary containment
// instead of full-string anchors.
//
// This module only DETECTS the trigger and builds a directive string
// to append to the model turn — it deliberately does NOT hand-roll the
// actual context-extraction/tool-calling logic in raw JS. Real
// synthesis (what's the goal, what's been tried, what's the next
// action) is exactly the kind of judgment an LLM does well and regex
// does badly; the directive routes that work through Nex's own
// Hyperfocus tools (lib/nexBrain.js, already wired in slice 3 part A)
// instead of duplicating it here at lower quality.

const BRING_IN_PATTERN = /\bbring\s+(claude|chat\s?gpt|chatgpt|chat|gpt|nex)\s+in(?:\s+on\s+this)?\s+for\s+hyperfocus\b/i;
const SHOW_ACTIVE_PATTERN = /\bshow\s+active\s+hyperfocus\b/i;
const COMPLETE_PATTERN = /\bhyperfocus\s+complete\b/i;

function normalizeAgent(raw) {
  const w = raw.toLowerCase().replace(/\s+/g, '');
  if (w === 'claude') return 'claude';
  if (w === 'nex') return 'nex';
  return 'chatgpt'; // "chat", "chatgpt", "gpt" all mean the same target
}

// Returns null (no trigger), or one of:
//   { type: 'bring_in', agent: 'claude' | 'chatgpt' | 'nex' }
//   { type: 'show_active' }
//   { type: 'complete' }
export function detectHyperfocusTrigger(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  if (!trimmed) return null;

  const bringMatch = trimmed.match(BRING_IN_PATTERN);
  if (bringMatch) {
    return { type: 'bring_in', agent: normalizeAgent(bringMatch[1]) };
  }
  if (SHOW_ACTIVE_PATTERN.test(trimmed)) return { type: 'show_active' };
  if (COMPLETE_PATTERN.test(trimmed)) return { type: 'complete' };
  return null;
}

// Builds the internal directive appended to the model's turn when a
// trigger fires. This text is NEVER shown to Justin or saved to the
// visible transcript — the caller (api/chat.js) sends the original
// message plus this directive to the model, then restores the
// original message before saving/returning history, so what Justin
// sees matches exactly what he typed.
export function buildHyperfocusDirective(trigger) {
  if (trigger.type === 'bring_in' && trigger.agent === 'claude') {
    return (
      '[HYPERFOCUS TRIGGER — Mr. Lopez just asked to bring Claude in on this. Do this now:] ' +
      '1) If there is already an active focus for this conversation, use its focus_id; otherwise call open_hyperfocus with a short real title for what you are working on, participants including "claude". ' +
      '2) Call publish_chat_context on that focus_id with the ACTUAL goal, evidence, attempted fixes, blockers, and next action from this conversation — write it for real, not a placeholder or a restatement of this instruction. ' +
      '3) Call wake_claude_code with a description that explicitly tells the woken Claude session to call read_hyperfocus on that exact focus_id first, before doing anything else. ' +
      '4) Tell Mr. Lopez plainly, in your reply, that Claude is being woken and give him the focus_id.'
    );
  }
  if (trigger.type === 'bring_in' && trigger.agent === 'chatgpt') {
    return (
      '[HYPERFOCUS TRIGGER — Mr. Lopez just asked to bring ChatGPT in on this. Do this now:] ' +
      'There is no automatic wake mechanism for ChatGPT yet (separate unbuilt board item — the ChatGPT wake relay epic task). Do this instead: ' +
      '1) If there is already an active focus for this conversation, use its focus_id; otherwise call open_hyperfocus with a short real title, participants including "chatgpt". ' +
      '2) Call publish_chat_context on that focus_id with the ACTUAL goal, evidence, attempted fixes, blockers, and next action — write it for real. ' +
      '3) Tell Mr. Lopez plainly, in your reply, the focus_id and that he will need to open a ChatGPT chat himself and reference that focus_id there (or say the equivalent trigger phrase in that chat), since ChatGPT cannot be woken automatically yet.'
    );
  }
  if (trigger.type === 'bring_in' && trigger.agent === 'nex') {
    return (
      '[HYPERFOCUS TRIGGER — Mr. Lopez said "bring Nex in on this for hyperfocus" in YOUR OWN chat. That phrase is meant to be said in a Claude or ChatGPT conversation to bring you (Nex) in — it does not apply here, since you are already the one he is talking to.] ' +
      'Tell him plainly that this phrase belongs in the other chat, not this one.'
    );
  }
  if (trigger.type === 'show_active') {
    return (
      '[HYPERFOCUS TRIGGER — Mr. Lopez asked to see active hyperfocus. Do this now:] ' +
      'Call list_active_hyperfocus and report back plainly what is currently open (title, participants, status) for each one. If none are active, say so plainly.'
    );
  }
  if (trigger.type === 'complete') {
    return (
      '[HYPERFOCUS TRIGGER — Mr. Lopez said "Hyperfocus complete". Do this now:] ' +
      'If you already know which focus_id is active in this conversation, call close_hyperfocus on it with a real, compact outcome summarizing what was actually resolved or decided — not a placeholder. ' +
      'If you are not sure which focus_id is the right one, call list_active_hyperfocus first to find the one relevant to this conversation before closing it. ' +
      'Do not close a focus without a genuine outcome — closing without one is rejected by the tool itself, and a vague or generic outcome defeats the whole point of Hyperfocus.'
    );
  }
  return '';
}
