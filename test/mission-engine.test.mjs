import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeText, DISCONNECTED_BOARD, fetchBoard, startPolling, visualFor, currentTaskFor,
} from '../public/mission-engine.js';

// --- safeText: this is the one thing standing between an agent's own
// posted task title/message and it running as script in a human's
// browser. Every skin depends on this being right. ---

test('safeText escapes all five HTML-significant characters', () => {
  assert.equal(safeText(`<script>&"'</script>`), '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
});

test('safeText handles null/undefined/non-string input without throwing', () => {
  assert.equal(safeText(null), '');
  assert.equal(safeText(undefined), '');
  assert.equal(safeText(42), '42');
});

test('safeText leaves plain text completely unchanged', () => {
  assert.equal(safeText('Fix the login bug'), 'Fix the login bug');
});

// --- fetchBoard: must never throw, and must always resolve to either
// real board data or the exact DISCONNECTED_BOARD shape — a skin
// should never need its own try/catch or ad-hoc empty state. ---

test('fetchBoard returns the real parsed board on a successful response', async () => {
  const board = { tasks: [{ id: 't1' }], agents: [{ id: 'nex' }] };
  const result = await fetchBoard(async () => ({ ok: true, json: async () => board }));
  assert.deepEqual(result, board);
});

test('fetchBoard falls back to DISCONNECTED_BOARD on a non-2xx response', async () => {
  const result = await fetchBoard(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.deepEqual(result, DISCONNECTED_BOARD);
});

test('fetchBoard falls back to DISCONNECTED_BOARD when the network call itself throws', async () => {
  const result = await fetchBoard(async () => { throw new Error('network down'); });
  assert.deepEqual(result, DISCONNECTED_BOARD);
});

test('fetchBoard falls back to DISCONNECTED_BOARD on malformed (non-JSON-object) response bodies', async () => {
  const result = await fetchBoard(async () => ({ ok: true, json: async () => null }));
  assert.deepEqual(result, DISCONNECTED_BOARD);
});

test('fetchBoard falls back to DISCONNECTED_BOARD when response.json() itself throws', async () => {
  const result = await fetchBoard(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }));
  assert.deepEqual(result, DISCONNECTED_BOARD);
});

// --- startPolling: fires immediately, repeats on the interval, skips
// ticks while the document is hidden, and stop() actually stops it —
// a leaked timer here would mean every skin switch adds another
// silent poller running forever. ---

function fakeDoc(initialHidden = false) {
  let hidden = initialHidden;
  const listeners = [];
  return {
    get hidden() { return hidden; },
    setHidden(value) { hidden = value; listeners.forEach((fn) => fn()); },
    addEventListener(event, fn) { if (event === 'visibilitychange') listeners.push(fn); },
    removeEventListener(event, fn) {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    get listenerCount() { return listeners.length; },
  };
}

// fetchBoard has two internal awaits (the fetch call, then res.json()),
// so a single `await Promise.resolve()` isn't enough microtask depth
// to let a tick's async work actually settle before the assertion
// runs — this flush was added after actually running the tests and
// seeing them fail on a real timing bug, not assumed correct upfront.
async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

// NOTE: this Node version's mock-timers API takes a plain array of
// timer names (['setInterval']), not { apis: [...] } — also caught by
// actually running these tests, not assumed from memory/docs.
test('startPolling fires immediately and again on the interval', async (t) => {
  t.mock.timers.enable(['setInterval']);
  const calls = [];
  const doc = fakeDoc();
  const stop = startPolling((board) => calls.push(board), {
    intervalMs: 1000,
    fetchImpl: async () => ({ ok: true, json: async () => ({ tasks: [], agents: [] }) }),
    doc,
  });
  await flushMicrotasks();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1000);
  await flushMicrotasks();
  assert.equal(calls.length, 2);
  stop();
  t.mock.timers.reset();
});

test('startPolling skips a tick while the document is hidden', async (t) => {
  t.mock.timers.enable(['setInterval']);
  const calls = [];
  const doc = fakeDoc(true); // starts hidden
  const stop = startPolling((board) => calls.push(board), {
    intervalMs: 1000,
    fetchImpl: async () => ({ ok: true, json: async () => ({ tasks: [], agents: [] }) }),
    doc,
  });
  await flushMicrotasks();
  assert.equal(calls.length, 0, 'the initial tick should be skipped while hidden');
  stop();
  t.mock.timers.reset();
});

test('startPolling stop() prevents further ticks and removes its listener', async (t) => {
  t.mock.timers.enable(['setInterval']);
  const calls = [];
  const doc = fakeDoc();
  const stop = startPolling((board) => calls.push(board), {
    intervalMs: 1000,
    fetchImpl: async () => ({ ok: true, json: async () => ({ tasks: [], agents: [] }) }),
    doc,
  });
  await flushMicrotasks();
  assert.equal(calls.length, 1);
  stop();
  assert.equal(doc.listenerCount, 0, 'stop() must remove the visibilitychange listener');
  t.mock.timers.tick(5000);
  await flushMicrotasks();
  assert.equal(calls.length, 1, 'no further ticks should fire after stop()');
  t.mock.timers.reset();
});

// --- visualFor / currentTaskFor: shared logic every skin relies on to
// mean the same thing everywhere. ---

test('visualFor returns the known mapping for a recognized agent id', () => {
  assert.deepEqual(visualFor({ id: 'claude' }), { color: '#A879FF', label: 'Claude' });
});

test('visualFor falls back to a generic color and the agent\'s own display name for an unknown agent', () => {
  const visual = visualFor({ id: 'mystery-agent', display_name: 'Mystery' });
  assert.equal(visual.color, '#8891A3');
  assert.equal(visual.label, 'Mystery');
});

test('currentTaskFor prefers an in-progress task over a completed one', () => {
  const tasks = [
    { id: 't1', owner: 'claude', status: 'complete' },
    { id: 't2', owner: 'claude', status: 'building' },
  ];
  assert.equal(currentTaskFor({ id: 'claude' }, tasks).id, 't2');
});

test('currentTaskFor falls back to the agent\'s most recent task if all are complete', () => {
  const tasks = [{ id: 't1', owner: 'claude', status: 'complete' }];
  assert.equal(currentTaskFor({ id: 'claude' }, tasks).id, 't1');
});

test('currentTaskFor returns null when the agent owns no tasks', () => {
  assert.equal(currentTaskFor({ id: 'claude' }, [{ id: 't1', owner: 'nex', status: 'building' }]), null);
});
