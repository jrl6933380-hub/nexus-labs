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


test('current team assignment keeps late handoffs, answers and resume details while older history stays bounded',()=>{
 const assignment='Role guidance: '+ 'x'.repeat(5000)+'\nSaved handoffs: {"project_id":"workout-b7"}\nUser answer: Daily checklist\nPrevious attempt: timer test passed';
 const compact=compactModelHistory([{role:'assistant',content:'old '.repeat(2000)},{role:'user',content:assignment}],{preserveCurrentUserMessage:true});
 assert.match(compact[0].content,/truncated/);assert.equal(compact[1].content,assignment);assert.match(compact[1].content,/timer test passed/);
});
