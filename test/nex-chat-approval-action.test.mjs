import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderApprovalAction } from '../public/nex-chat-bar.js';

const chatSource = await readFile(new URL('../api/chat.js', import.meta.url), 'utf8');
const brainSource = await readFile(new URL('../lib/nexBrain.js', import.meta.url), 'utf8');
const dockSource = await readFile(new URL('../public/nex-chat-bar.js', import.meta.url), 'utf8');
const teamSource = await readFile(new URL('../public/team-chat.js', import.meta.url), 'utf8');
const workspaceSource = await readFile(new URL('../public/workspace.html', import.meta.url), 'utf8');

test('queued pull request merges return structured approval metadata', () => {
  assert.match(brainSource, /kind: 'merge_pull_request'/u);
  assert.match(brainSource, /label: `Merge PR #\$\{block\.input\.pull_number\}`/u);
  assert.match(brainSource, /reviewUrl:/u);
  assert.match(chatSource, /pendingApproval/u);
});

test('chat approval button posts the exact queue id to the existing approval endpoint', () => {
  assert.match(dockSource, /fetch\('\/api\/queue'/u);
  assert.match(dockSource, /JSON\.stringify\(\{ id: approval\.id, action: 'approve' \}\)/u);
});

test('approval renderer ignores anything except a queued merge action', () => {
  assert.equal(renderApprovalAction({ approval: null, container: {} }), null);
  assert.equal(renderApprovalAction({ approval: { kind: 'delete_repo', id: 'danger' }, container: {} }), null);
  assert.equal(renderApprovalAction({ approval: { kind: 'merge_pull_request' }, container: {} }), null);
});

test('main and team chats show PR context and approve the exact queued merge', () => {
  assert.match(dockSource, /approval\.description/u);
  assert.match(dockSource, /approval\.reviewUrl/u);
  assert.match(dockSource, /innerText = 'Read PR'/u);
  assert.match(teamSource, /step\.pending_approval/u);
  assert.match(teamSource, /JSON\.stringify\(\{id:approval\.id,action:'approve'\}\)/u);
  assert.match(teamSource, /team_resolve_approval/u);
  assert.match(workspaceSource, /data\.pendingApproval\.reviewUrl/u);
  assert.match(workspaceSource, /textContent='Read PR'/u);
});
