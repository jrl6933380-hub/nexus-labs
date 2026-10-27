import test from 'node:test';
import assert from 'node:assert/strict';
import { readPage, validPageUrl } from '../lib/pageReader.js';

const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

test('only public https addresses are accepted', () => {
  assert.equal(validPageUrl('https://www.caseys.com/menu'), 'https://www.caseys.com/menu');
  for (const bad of ['http://caseys.com', 'https://localhost/x', 'https://127.0.0.1/', 'https://user:pw@caseys.com', 'ftp://a.com', 'nope', 'https://intranet/']) {
    assert.throws(() => validPageUrl(bad), (e) => e.status === 400, bad);
  }
});

test('returns the page text and says it opened', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return reply(200, { candidates: [{ content: { parts: [{ text: 'Large pizza $13.99' }] }, urlContextMetadata: { urlMetadata: [{ retrievedUrl: 'https://a.com/', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' }] } }] })(); };
  const out = await readPage({ url: 'https://a.com/', question: 'pizza prices' }, { fetchImpl, env: { GEMINI_API_KEY: 'k' } });
  assert.equal(out.opened, true);
  assert.match(out.text, /13\.99/);
  assert.equal(seen.init.headers['x-goog-api-key'], 'k');
  assert.ok(!seen.url.includes('key='), 'key is sent in a header, never the address');
  assert.deepEqual(JSON.parse(seen.init.body).tools, [{ url_context: {} }]);
});

test('a page Google could not open is flagged so no prices are reported', async () => {
  const fetchImpl = reply(200, { candidates: [{ content: { parts: [{ text: 'I could not open it.' }] }, urlContextMetadata: { urlMetadata: [{ urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_ERROR' }] } }] });
  const out = await readPage({ url: 'https://a.com/' }, { fetchImpl, env: { GEMINI_API_KEY: 'k' } });
  assert.equal(out.opened, false);
  assert.match(out.note, /Do not report prices/);
});

test('missing key and upstream errors are clear', async () => {
  await assert.rejects(() => readPage({ url: 'https://a.com/' }, { env: {} }), (e) => e.status === 503);
  await assert.rejects(() => readPage({ url: 'https://a.com/' }, { fetchImpl: reply(429, {}), env: { GEMINI_API_KEY: 'k' } }), (e) => e.status === 502 && !/k\b/.test(e.message));
});
