import test from 'node:test';
import assert from 'node:assert/strict';

import { extractJsonObject, parseAssistantDecision } from '../api/room-assistant.js';

// The decision JSON now comes from whatever model the customer's Builder Brain
// routes to. Anthropic answers with a bare object; OpenRouter's free router
// picks among many open-weight models and plenty of them wrap it in prose.
// These are the shapes that actually showed up in production.

test('bare JSON parses', () => {
  const decision = parseAssistantDecision('{"kind":"reply","message":"hi"}');
  assert.equal(decision.kind, 'reply');
  assert.equal(decision.message, 'hi');
});

test('fenced JSON parses', () => {
  const decision = parseAssistantDecision('```json\n{"kind":"reply","message":"hi"}\n```');
  assert.equal(decision.kind, 'reply');
});

test('a preamble before the object is tolerated', () => {
  const decision = parseAssistantDecision('Sure! Here is the JSON:\n{"kind":"reply","message":"hi"}');
  assert.equal(decision.message, 'hi');
});

test('a sign-off after the object is tolerated', () => {
  const decision = parseAssistantDecision('{"kind":"reply","message":"hi"}\n\nLet me know if that helps!');
  assert.equal(decision.message, 'hi');
});

test('prose containing braces on both sides still finds the real object', () => {
  // This is the case the old first-brace-to-last-brace slice broke on: it
  // would span from the stray "{" in the prose to the stray "}" at the end
  // and fail to parse the whole thing.
  const raw = 'Here you go {note} :\n{"kind":"reply","message":"hi"}\nHope that works {for you}';
  const decision = parseAssistantDecision(raw);
  assert.equal(decision.message, 'hi');
});

test('nested objects survive intact', () => {
  const decision = parseAssistantDecision(
    'noise {"kind":"build","message":"m","meta":{"a":{"b":1}},"instruction":"go"} noise'
  );
  assert.equal(decision.kind, 'build');
  assert.equal(decision.instruction, 'go');
});

test('braces inside a JSON string do not truncate the object', () => {
  const decision = parseAssistantDecision('{"kind":"reply","message":"use } and { carefully"}');
  assert.equal(decision.message, 'use } and { carefully');
});

test('escaped quotes inside a string are handled', () => {
  const decision = parseAssistantDecision('{"kind":"reply","message":"say \\"hi\\" now"}');
  assert.equal(decision.message, 'say "hi" now');
});

test('pure prose yields no object, so the handler can degrade gracefully', () => {
  assert.equal(extractJsonObject('I can definitely help you build that!'), null);
  assert.throws(() => parseAssistantDecision('I can definitely help you build that!'));
});

test('an unterminated object is rejected rather than half-parsed', () => {
  assert.equal(extractJsonObject('{"kind":"reply","message":"oops"'), null);
});

test('a build decision still requires an instruction', () => {
  assert.throws(() => parseAssistantDecision('{"kind":"build","message":"sure"}'));
});

test('an unknown kind is still rejected', () => {
  assert.throws(() => parseAssistantDecision('{"kind":"delete_everything","message":"ok"}'));
});
