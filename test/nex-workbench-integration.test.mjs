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

test('Projects shelf exposes preview, Nex editing and fine-tune destinations',()=>{
 assert.match(views,/open\(buildId, 'preview'\)/u);assert.match(views,/open\(buildId, 'edit'\)/u);assert.match(views,/preferredBuilderMode\(\)/u);
 assert.match(workspace,/\['preview','fine','add-piece'\]\.includes\(mode\)/u);
 assert.match(forge,/\['preview','fine','add-piece'\]\.includes\(requestedView\)/u);
});
