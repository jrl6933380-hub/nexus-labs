import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const { extractFilePaths, findScopeCollisions, postMessage } = await import('../lib/board.js');

test('extractFilePaths pulls repo-path-shaped tokens out of free text', () => {
  const text = 'SCOPE: editing lib/board.js and api/board.js, not touching public/index.html today.';
  assert.deepEqual(
    extractFilePaths(text),
    ['lib/board.js', 'api/board.js', 'public/index.html'],
  );
});

test('extractFilePaths returns nothing for plain prose with no paths', () => {
  assert.deepEqual(extractFilePaths('just chatting on the board, nothing to announce'), []);
});

test('findScopeCollisions flags an overlapping file from a different agent\'s recent scope-announce', async () => {
  const now = 10_000_000;
  const messages = [
    { from: 'chatgpt', message: 'SCOPE: editing lib/board.js for the metering slice', at: now - 1_000 },
  ];
  const collisions = await findScopeCollisions({
    from: 'claude',
    message: 'SCOPE: touching lib/board.js for the scope-collision check',
    at: now,
    messages,
  });
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].from, 'chatgpt');
  assert.deepEqual(collisions[0].files, ['lib/board.js']);
});

test('findScopeCollisions ignores the same agent re-announcing its own work', async () => {
  const now = 10_000_000;
  const messages = [
    { from: 'claude', message: 'SCOPE: editing lib/board.js', at: now - 1_000 },
  ];
  const collisions = await findScopeCollisions({
    from: 'claude',
    message: 'SCOPE: still editing lib/board.js',
    at: now,
    messages,
  });
  assert.deepEqual(collisions, []);
});

test('findScopeCollisions ignores announces outside the recent window', async () => {
  const now = 10_000_000;
  const sevenHoursMs = 7 * 60 * 60 * 1000;
  const messages = [
    { from: 'chatgpt', message: 'SCOPE: editing lib/board.js', at: now - sevenHoursMs },
  ];
  const collisions = await findScopeCollisions({
    from: 'claude',
    message: 'SCOPE: editing lib/board.js',
    at: now,
    messages,
  });
  assert.deepEqual(collisions, []);
});

test('findScopeCollisions ignores messages that are not scope-announces', async () => {
  const now = 10_000_000;
  const messages = [
    { from: 'chatgpt', message: 'just mentioning lib/board.js in passing, not a scope announce', at: now - 1_000 },
  ];
  const collisions = await findScopeCollisions({
    from: 'claude',
    message: 'SCOPE: editing lib/board.js',
    at: now,
    messages,
  });
  assert.deepEqual(collisions, []);
});

test('findScopeCollisions returns nothing when the new message has no file paths', async () => {
  const collisions = await findScopeCollisions({
    from: 'claude',
    message: 'SCOPE: general planning, no files touched yet',
    at: 10_000_000,
    messages: [{ from: 'chatgpt', message: 'SCOPE: editing lib/board.js', at: 9_999_000 }],
  });
  assert.deepEqual(collisions, []);
});

test('postMessage attaches a non-blocking scope_check flag on a real collision, without preventing the post', async () => {
  const priorEntry = JSON.stringify({ from: 'chatgpt', message: 'SCOPE: editing lib/board.js for something else', at: Date.now() - 1_000 });
  let lastCommand = null;
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    lastCommand = command;
    if (command[0] === 'LRANGE') {
      return { ok: true, async json() { return { result: [priorEntry] }; } };
    }
    return { ok: true, async json() { return { result: 'OK' }; } };
  };

  const entry = await postMessage({ from: 'claude', message: 'SCOPE: also editing lib/board.js today' });
  assert.equal(entry.scope_check.flagged, true);
  assert.equal(entry.scope_check.collisions[0].from, 'chatgpt');
  assert.deepEqual(entry.scope_check.collisions[0].files, ['lib/board.js']);
  // the post itself still went through (LPUSH), not blocked by the flag
  assert.ok(lastCommand);
});

test('postMessage does not attach a scope_check flag for an ordinary non-scope message', async () => {
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'LRANGE') {
      return { ok: true, async json() { return { result: [] }; } };
    }
    return { ok: true, async json() { return { result: 'OK' }; } };
  };

  const entry = await postMessage({ from: 'claude', message: 'just a status update, nothing structured' });
  assert.equal(entry.scope_check, undefined);
});
