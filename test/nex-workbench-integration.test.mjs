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
  assert.match(workspace, /threadId:targetThread,requestId,respondAsync:true,[^}]*workspace:workspaceContext\(\)/u);
  assert.match(chat, /listConversationThreads\(operatorUser\)/u);
  assert.match(chat, /action === 'save_thread'/u);
  assert.match(chat, /loadConversation\(operatorUser, threadId\)/u);
});

test('Projects shelf opens the project home before its three editing modes',()=>{
 assert.match(views,/open\(buildId,'overview',title\)/u);
 assert.match(views,/More ways to build/u);
 assert.doesNotMatch(views,/preferredBuilderMode\(\)/u);
 assert.match(workspace,/\['overview','preview','fine','add-piece'\]\.includes\(mode\)/u);
 assert.match(forge,/\['overview','preview','fine','add-piece'\]\.includes\(requestedView\)/u);
 assert.match(forge,/\['overview', 'preview', 'fine', 'pages', 'stack'\]\.includes\(destination\)/u);
});
