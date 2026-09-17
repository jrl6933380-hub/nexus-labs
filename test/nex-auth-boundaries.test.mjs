import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [chat, recentChat, privateLane, memory] = await Promise.all([
  readFile(new URL('../api/chat.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/chat-recent.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/claude-message.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/memory.js', import.meta.url), 'utf8'),
]);

test('Nex chat is operator-authenticated and conversation keys are operator scoped', () => {
  assert.match(chat, /isOperatorUser\(operatorUser\)/u);
  assert.match(chat, /recentKeyFor\(operatorUser\)/u);
  assert.match(recentChat, /isOperatorUser\(operatorUser\)/u);
  assert.match(recentChat, /loadRecentConversation\(operatorUser\)/u);
  assert.doesNotMatch(chat, /const RECENT_KEY = 'nex:recent-conversation'/u);
});

test('private agent-to-Nex lane requires an operator session or internal bearer token', () => {
  assert.match(privateLane, /NEXUS_AGENT_API_TOKEN/u);
  assert.match(privateLane, /timingSafeEqual/u);
  assert.match(privateLane, /status\(401\)/u);
});

test('memory management is operator-only', () => {
  assert.match(memory, /isOperatorUser\(username\)/u);
  assert.match(memory, /status\(401\)/u);
});
