import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryHandler } from '../api/room-history.js';

function response() {
  return {
    code: 0, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

test('opening a saved project includes its clean live URL and publish time', async () => {
  const handler = createHistoryHandler({
    resolveUser: async () => 'alice',
    readBuild: async () => ({ id: 'b1', projectId: 'p1', html: '<!doctype html><h1>Site</h1>', createdAt: 200 }),
    readLiveSite: async () => ({ projectId: 'p1', url: 'https://customer-site.vercel.app', publishedAt: 150 }),
  });
  const res = response();
  await handler({ method: 'GET', query: { id: 'b1' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.build.liveUrl, 'https://customer-site.vercel.app');
  assert.equal(res.body.build.livePublishedAt, 150);
});
