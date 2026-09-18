import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [chat, recentChat, privateLane, memory] = await Promise.all([
  readFile(new URL('../api/chat.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/chat-recent.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/claude-message.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/memory.js', import.meta.url), 'utf8'),
]);

test('Nex chat uses dedicated owner auth and conversation keys are owner scoped', () => {
  assert.match(chat, /getNexusOwner\(req\)/u);
  assert.doesNotMatch(chat, /roomAuth/u);
  assert.match(chat, /recentKeyFor\(operatorUser\)/u);
  assert.match(recentChat, /getNexusOwner\(req\)/u);
  assert.doesNotMatch(recentChat, /roomAuth/u);
  assert.match(recentChat, /loadRecentConversation\(operatorUser\)/u);
  assert.doesNotMatch(chat, /const RECENT_KEY = 'nex:recent-conversation'/u);
});

test('private agent-to-Nex lane requires an owner session or internal bearer token', () => {
  assert.match(privateLane, /NEXUS_AGENT_API_TOKEN/u);
  assert.match(privateLane, /getNexusOwner\(req\)/u);
  assert.doesNotMatch(privateLane, /roomAuth/u);
  assert.match(privateLane, /timingSafeEqual/u);
  assert.match(privateLane, /status\(401\)/u);
});

test('memory management is Nexus-owner-only', () => {
  assert.match(memory, /getNexusOwner\(req\)/u);
  assert.doesNotMatch(memory, /roomAuth/u);
  assert.match(memory, /status\(401\)/u);
});
