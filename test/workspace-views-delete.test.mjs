import test from 'node:test';
import assert from 'node:assert/strict';

import { deleteTaskButton } from '../public/workspace-views.js';

function makeButton({ post = async () => ({}), onDeleted = null, confirmAnswer = true } = {}) {
  if (!global.document) global.document = {};
  global.document.createElement = (tag) => ({
    tagName: tag,
    className: '',
    type: '',
    title: '',
    textContent: '',
    disabled: false,
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    onclick: null,
  });
  global.window = {
    confirm: () => confirmAnswer,
    alert: () => {},
  };
  return deleteTaskButton({
    id: 't-1',
    title: 'Old task',
    post,
    onDeleted,
  });
}

test('deleteTaskButton builds a labeled ✕ button', () => {
  const button = makeButton();
  assert.equal(button.textContent, '✕');
  assert.equal(button.className, 'rowdel');
  assert.equal(button.attrs['aria-label'], 'Delete task: Old task');
});

test('a confirmed delete posts delete_task with the id, stops propagation, and re-renders', async () => {
  let posted = null;
  let deleted = false;
  let stopped = false;
  const button = makeButton({
    post: async (url, body) => { posted = { url, body }; },
    onDeleted: async () => { deleted = true; },
  });
  await button.onclick({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(posted, { url: '/api/board', body: { action: 'delete_task', id: 't-1' } });
  assert.equal(deleted, true);
});

test('a cancelled delete posts nothing', async () => {
  let posted = null;
  const button = makeButton({ confirmAnswer: false, post: async (url, body) => { posted = { url, body }; } });
  await button.onclick({ stopPropagation: () => {} });
  assert.equal(posted, null);
});

test('a failed delete re-enables the button and surfaces the error', async () => {
  let alerted = null;
  const button = makeButton({ post: async () => { throw new Error('nope'); } });
  global.window.alert = (message) => { alerted = message; };
  await button.onclick({ stopPropagation: () => {} });
  assert.equal(button.disabled, false);
  assert.match(alerted, /Delete failed: nope/);
});
