import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('specialist and group chats keep one relationship thread', async () => {
  const workspace=await readFile(new URL('../public/workspace.html',import.meta.url),'utf8');
  assert.match(workspace,/persistentConversation=\['specialist','group'\]\.includes\(activeConversation\?\.kind\)/u);
  assert.match(workspace,/persistentConversation\?\[\]:\[fresh\]/u);
  assert.match(workspace,/Clear this chat, keep key memories/u);
});

test('builder visuals can be saved to Projects and opened in Workbench', async () => {
  const [team,visual]=await Promise.all([
    readFile(new URL('../public/team-chat.js',import.meta.url),'utf8'),
    readFile(new URL('../public/chat-visual.js',import.meta.url),'utf8'),
  ]);
  assert.match(visual,/Saving draft/u);assert.match(visual,/Open project/u);
  assert.match(visual,/Saved to Projects/u);
  assert.match(team,/action:'save_chat_visual'/u);
  assert.match(visual,/forge\.html\?surface=workbench&view=chat&build=/u);
  const workspace=await readFile(new URL('../public/workspace.html',import.meta.url),'utf8');
  assert.match(workspace,/appendAssistantVisual\(pending,reply,raw\)/u);
  assert.match(workspace,/appendAssistantVisual\(body,message\.content\)/u);
});
