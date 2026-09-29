import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The deck's delete button is frontend wiring over the existing POST
// /api/board action=delete_task route (lib/board.js deleteTask, already
// covered by test/board-delete-task.test.mjs). These tests pin the two
// seams that could silently drift: the API route must still map
// delete_task to deleteTask, and the UI must (a) require an explicit
// confirm, (b) call the correct endpoint/action, and (c) refresh the
// deck after deleting.
const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

async function read(rel) {
  return readFile(path.join(root, rel), 'utf8');
}

test('api/board.js still routes delete_task to deleteTask', async () => {
  const source = await read('../api/board.js');
  assert.ok(source.includes(`action === 'delete_task'`), 'delete_task action is missing from /api/board');
  assert.ok(
    source.includes(`await deleteTask(params)`),
    'delete_task action is no longer wired to deleteTask',
  );
});

test('deck shows a delete button on task rows', async () => {
  const views = await read('../public/workspace-views.js');
  assert.ok(views.includes('deleteTask'), 'deck view is missing a deleteTask handler');
  assert.ok(views.includes('aria-label'), 'delete button needs an accessible label');
  const rowBlock = views.slice(views.indexOf('Open', views.indexOf('deck:')));
  assert.ok(rowBlock.includes('aria-label="Delete task"'), 'delete button is missing from open-task rows');
});

test('deleteTask requires a confirm before deleting', async () => {
  const shell = await read('../public/workspace.html');
  const fnStart = shell.indexOf('async function deleteTask(');
  assert.ok(fnStart > -1, 'deleteTask function is missing from workspace.html');
  const fn = shell.slice(fnStart, shell.indexOf('\nfunction ', fnStart + 10) + 10);
  assert.ok(fn.includes("confirm(`"), 'deleteTask must ask for confirmation before deleting');
  assert.ok(fn.includes("action: 'delete_task'"), 'deleteTask must POST action=delete_task');
  assert.ok(fn.includes('/api/board'), 'deleteTask must hit /api/board');
  assert.ok(fn.includes("showView('deck')"), 'deleteTask must refresh the deck after deleting');
});

test('openTask detail screen offers Delete as a last action', async () => {
  const shell = await read('../public/workspace.html');
  const detailStart = shell.indexOf('async function openTask(');
  const detailBlock = shell.slice(detailStart, shell.indexOf('function taskNote('));
  assert.ok(detailBlock.includes('label:\'Delete task\''), 'openTask is missing a Delete task action');
  assert.ok(detailBlock.includes('ctx.deleteTask'), 'openTask delete action must go through the confirm handler');
});
