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

test('Projects gallery renders real builds and defaults selected cards to full preview', () => {
  assert.match(views, /getJSON\('\/api\/room-history'\)/u);
  assert.match(views, /className = 'projectgrid'/u);
  assert.match(views, /ctx\.openWorkbenchPanel\(buildId, 'preview'\)/u);
  assert.match(views, /ctx\.openWorkbenchPanel\(buildId, 'edit'\)/u);
  assert.match(workspace, /view=\$\{mode === 'edit' \? 'chat' : 'preview'\}/u);
  assert.match(forge, /startupParams\.get\('build'\)/u);
  assert.match(forge, /await ctx\.openBuild\(requestedBuild, requestedView === 'preview' \? 'preview' : 'chat'\)/u);
});
