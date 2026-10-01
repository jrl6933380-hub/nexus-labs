import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../public/workspace.html', import.meta.url), 'utf8');
const views = await readFile(new URL('../public/workspace-views.js', import.meta.url), 'utf8');
const forge = await readFile(new URL('../public/forge.html', import.meta.url), 'utf8');
const chat = await readFile(new URL('../api/chat.js', import.meta.url), 'utf8');

test('Nex Chat sends a stable thread id and loads cloud thread summaries', () => {
  assert.match(workspace, /fetch\('\/api\/chat\?threads=1'/u);
  assert.match(workspace, /action:'save_thread'/u);
  assert.match(workspace, /threadId, workspace: workspaceContext\(\)/u);
  assert.match(chat, /listConversationThreads\(operatorUser\)/u);
  assert.match(chat, /action === 'save_thread'/u);
  assert.match(chat, /loadConversation\(operatorUser, threadId\)/u);
});

test('Workbench renders real Forge projects and deep-links the selected build', () => {
  assert.match(views, /getJSON\('\/api\/room-history'\)/u);
  assert.match(views, /ctx\.openWorkbenchPanel\(buildId\)/u);
  assert.match(workspace, /forge\.html\?view=chat&build=/u);
  assert.match(forge, /startupParams\.get\('build'\)/u);
  assert.match(forge, /await ctx\.openBuild\(requestedBuild\)/u);
});
