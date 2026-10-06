import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const api=await readFile(new URL('../api/chat.js',import.meta.url),'utf8');
const workspace=await readFile(new URL('../public/workspace.html',import.meta.url),'utf8');

test('workspace Nex turns are detached from the phone connection',()=>{
  assert.match(api,/import \{ waitUntil \} from '@vercel\/functions'/u);
  assert.match(api,/export const config = \{ maxDuration: 300 \}/u);
  assert.match(api,/req\.body\?\.respondAsync === true/u);
  assert.match(api,/waitUntil\(work\)/u);
  assert.match(api,/state: 'queued'/u);
});

test('both workspace chat surfaces use durable request recovery',()=>{
  assert.match(workspace,/PENDING_CHAT_KEY='nexus:workspace:pending-chat:v1'/u);
  assert.match(workspace,/async function durableChatRequest/u);
  assert.match(workspace,/requestId,respondAsync:true/u);
  assert.match(workspace,/async function waitForChatRequest/u);
  assert.equal((workspace.match(/await durableChatRequest\(/gu) || []).length,2);
  assert.match(workspace,/Nex is still working in the background/u);
  assert.match(workspace,/You can leave Nexus and come back/u);
});
