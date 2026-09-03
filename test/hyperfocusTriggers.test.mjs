import { detectHyperfocusTrigger } from '../lib/hyperfocusTriggers.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Exact spec phrases
test('bring claude exact', () => {
  assert.deepEqual(detectHyperfocusTrigger('Bring Claude in on this for hyperfocus'), { type: 'bring_in', agent: 'claude' });
});
test('bring chat exact', () => {
  assert.deepEqual(detectHyperfocusTrigger('Bring Chat in on this for hyperfocus'), { type: 'bring_in', agent: 'chatgpt' });
});
test('bring nex exact', () => {
  assert.deepEqual(detectHyperfocusTrigger('Bring Nex in on this for hyperfocus'), { type: 'bring_in', agent: 'nex' });
});
test('show active exact', () => {
  assert.deepEqual(detectHyperfocusTrigger('Show active hyperfocus'), { type: 'show_active' });
});
test('complete exact', () => {
  assert.deepEqual(detectHyperfocusTrigger('Hyperfocus complete'), { type: 'complete' });
});

// Case insensitivity + trailing punctuation
test('bring claude lowercase and period', () => {
  assert.deepEqual(detectHyperfocusTrigger('bring claude in on this for hyperfocus.'), { type: 'bring_in', agent: 'claude' });
});
test('show active all caps', () => {
  assert.deepEqual(detectHyperfocusTrigger('SHOW ACTIVE HYPERFOCUS'), { type: 'show_active' });
});
test('complete mixed case with exclamation', () => {
  assert.deepEqual(detectHyperfocusTrigger('Hyperfocus Complete!'), { type: 'complete' });
});

// Synonyms for chatgpt
test('bring chatgpt one word', () => {
  assert.deepEqual(detectHyperfocusTrigger('bring chatgpt in on this for hyperfocus'), { type: 'bring_in', agent: 'chatgpt' });
});
test('bring gpt', () => {
  assert.deepEqual(detectHyperfocusTrigger('bring gpt in on this for hyperfocus'), { type: 'bring_in', agent: 'chatgpt' });
});
test('bring chat gpt spaced', () => {
  assert.deepEqual(detectHyperfocusTrigger('bring chat gpt in on this for hyperfocus'), { type: 'bring_in', agent: 'chatgpt' });
});

// Optional "on this"
test('bring claude without on-this', () => {
  assert.deepEqual(detectHyperfocusTrigger('bring claude in for hyperfocus'), { type: 'bring_in', agent: 'claude' });
});

// Embedded in a longer sentence (word-boundary containment, not full-string anchor)
test('trigger embedded in a longer sentence', () => {
  assert.deepEqual(detectHyperfocusTrigger('ok can you bring claude in on this for hyperfocus please'), { type: 'bring_in', agent: 'claude' });
});

// Non-matches
test('unrelated message does not match', () => {
  assert.equal(detectHyperfocusTrigger('what is the weather like'), null);
});
test('casual mention of hyperfocus does not match', () => {
  assert.equal(detectHyperfocusTrigger('I read about hyperfocus once'), null);
});
test('empty string does not match', () => {
  assert.equal(detectHyperfocusTrigger(''), null);
});
test('non-string input does not match', () => {
  assert.equal(detectHyperfocusTrigger(null), null);
});
test('whitespace-only input does not match', () => {
  assert.equal(detectHyperfocusTrigger('   '), null);
});
test('bring-in without the word hyperfocus does not match', () => {
  assert.equal(detectHyperfocusTrigger('bring claude in on this'), null);
});
test('show active tasks does not match show active hyperfocus', () => {
  assert.equal(detectHyperfocusTrigger('show me the active tasks'), null);
});
