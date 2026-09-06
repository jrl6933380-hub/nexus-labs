import test from 'node:test';
import assert from 'node:assert/strict';
import { compactModelHistory } from '../lib/nexBrain.js';

test('model history keeps the recent window and caps oversized messages', () => {
  const history = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: String(index).repeat(20),
  }));
  history[13].content = 'x'.repeat(100);
  const compact = compactModelHistory(history, { maxMessages: 3, maxContentChars: 30 });
  assert.equal(compact.length, 3);
  assert.match(compact[0].content, /^11/);
  assert.match(compact[2].content, /truncated for this turn/);
  assert.equal(history[13].content.length, 100);
});
