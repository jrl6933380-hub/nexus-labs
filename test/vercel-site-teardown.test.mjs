import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VERCEL_TOKEN = 'test-token';
const { deleteStaticSite } = await import('../lib/vercel.js');

test('a customer room site is deleted by project name', async () => {
  const calls = [];
  const request = async (path, options) => { calls.push({ path, method: options.method }); return {}; };
  const result = await deleteStaticSite({ projectName: 'room-alice-p1', request });
  assert.equal(result.deleted, true);
  assert.equal(calls[0].method, 'DELETE');
  assert.match(calls[0].path, /^\/v9\/projects\/room-alice-p1/);
});

test('it refuses to delete anything that is not a customer room site', async () => {
  // This is the guard that matters: the function can permanently delete a
  // Vercel project, and the platform's own projects live in the same
  // account. A caller being wrong must fail loudly, not delete nexus-labs.
  const request = async () => { throw new Error('must never reach the API'); };
  for (const name of ['nexus-labs', 'github-write-mcp', '', 'Room-Alice-P1', '../nexus-labs', 'roomy-thing']) {
    await assert.rejects(
      () => deleteStaticSite({ projectName: name, request }),
      /not a customer room site/,
      `${name || '(empty)'} must be refused`,
    );
  }
});

test('a site that is already gone counts as taken down', async () => {
  // The caller's goal is "not live anymore". A 404 means it isn't.
  const request = async () => { throw new Error('Vercel API error (404): {"error":"not_found"}'); };
  const result = await deleteStaticSite({ projectName: 'room-alice-gone', request });
  assert.equal(result.deleted, true);
  assert.equal(result.alreadyGone, true);
});

test('a real API failure reports not-deleted rather than pretending', async () => {
  const request = async () => { throw new Error('Vercel API error (500): {"error":"boom"}'); };
  const result = await deleteStaticSite({ projectName: 'room-alice-p1', request });
  assert.equal(result.deleted, false);
  assert.match(result.reason, /500/);
});
