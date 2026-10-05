import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderApprovalAction } from '../public/nex-chat-bar.js';

const chatSource = await readFile(new URL('../api/chat.js', import.meta.url), 'utf8');
const brainSource = await readFile(new URL('../lib/nexBrain.js', import.meta.url), 'utf8');
const dockSource = await readFile(new URL('../public/nex-chat-bar.js', import.meta.url), 'utf8');

test('queued pull request merges return structured approval metadata', () => {
  assert.match(brainSource, /kind: 'merge_pull_request'/u);
  assert.match(brainSource, /label: 'Approve & merge'/u);
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
