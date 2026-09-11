import assert from 'node:assert/strict';
import test from 'node:test';

import { selectBoardRead } from '../lib/board.js';

const tasks = [
  { id: 'old', title: 'Old completed task', description: '123 only in task history', status: 'complete', owner: 'claude' },
  { id: 'live', title: 'Live task', description: 'Current work', status: 'building', owner: 'nex' },
];
const messages = [
  { from: 'claude', message: '123 newest note for Nex', at: 3 },
  { from: 'chatgpt', message: 'another note', at: 2 },
  { from: 'claude', message: 'older Claude note', at: 1 },
];

test('active view excludes completed tasks and keeps newest messages first', () => {
  const result = selectBoardRead({ tasks, messages }, { view: 'active', task_limit: 40, message_limit: 2 });
  assert.deepEqual(result.tasks.map((task) => task.id), ['live']);
  assert.deepEqual(result.messages.map((entry) => entry.message), ['123 newest note for Nex', 'another note']);
  assert.equal(result.page.total_tasks, 2);
});

test('messages view can find an exact agent note without returning task history', () => {
  const result = selectBoardRead({ tasks, messages }, { view: 'messages', from: 'claude', query: '123', message_limit: 20 });
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.messages, [messages[0]]);
  assert.equal(Object.keys(result)[0], 'messages');
});

test('all view preserves access to completed task history', () => {
  const result = selectBoardRead({ tasks, messages }, { view: 'all', query: '123', task_limit: 20, message_limit: 20 });
  assert.deepEqual(result.tasks.map((task) => task.id), ['old']);
  assert.deepEqual(result.messages.map((entry) => entry.message), ['123 newest note for Nex']);
});
