import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  beginOpenRouterOAuth,
  completeOpenRouterOAuth,
  createMemoryAttemptStore,
  forgeCredentialScope,
} from '../lib/openRouterConnection.js';
import { createOpenRouterOAuthHandler } from '../api/openrouter-oauth.js';
import { routeOpenRouterStream, toOpenRouterRequest } from '../lib/openRouterRouter.js';

process.env.NEXUS_GRANT_SIGNING_SECRET = 'test-secret-that-is-long-enough-for-hmac';

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test('PKCE start binds a one-time attempt to the Forge account and project', async () => {
  const store = createMemoryAttemptStore();
  const started = await beginOpenRouterOAuth({
    ownerUsername: 'Alice',
    projectId: 'salon',
    store,
    env: { FORGE_PUBLIC_URL: 'https://forge.example', NODE_ENV: 'production' },
  });

  const authorize = new URL(started.authorizeUrl);
  assert.equal(authorize.origin, 'https://openrouter.ai');
  assert.equal(authorize.pathname, '/auth');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorize.searchParams.get('code_challenge'));
  const callback = new URL(authorize.searchParams.get('callback_url'));
  assert.equal(callback.origin, 'https://forge.example');
  assert.equal(callback.searchParams.get('action'), 'callback');
  assert.ok(callback.searchParams.get('state'));
  assert.equal(started.tenantId, forgeCredentialScope({ ownerUsername: 'alice', projectId: 'salon' }));
});

test('callback exchanges and validates the key once without returning it as metadata', async () => {
  const store = createMemoryAttemptStore();
  const started = await beginOpenRouterOAuth({
    ownerUsername: 'alice', projectId: 'app', store,
    env: { FORGE_PUBLIC_URL: 'https://forge.example', NODE_ENV: 'production' },
  });
  const state = new URL(new URL(started.authorizeUrl).searchParams.get('callback_url')).searchParams.get('state');
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/keys')) return jsonResponse({ key: 'sk-or-v1-this-is-a-user-owned-test-key' });
    return jsonResponse({ data: { is_free_tier: true, limit: 10, limit_remaining: 9 } });
  };

  const result = await completeOpenRouterOAuth({ state, code: 'single-use-code', ownerUsername: 'alice', store, fetchFn });
  assert.equal(result.accessToken, 'sk-or-v1-this-is-a-user-owned-test-key');
  assert.equal(result.metadata.is_free_tier, true);
  assert.equal(result.metadata.limit_remaining, 9);
  assert.equal(JSON.stringify(result.metadata).includes(result.accessToken), false);
  assert.match(result.metadata.settings_url, /^https:\/\/openrouter\.ai\/keys\/[a-f0-9]{64}$/);
  assert.equal(JSON.parse(calls[0].options.body).code_verifier.length >= 43, true);

  await assert.rejects(
    completeOpenRouterOAuth({ state, code: 'replay', ownerUsername: 'alice', store, fetchFn }),
    /already used|expired/,
  );
});

test('callback rejects a different signed-in Forge account before key exchange', async () => {
  const store = createMemoryAttemptStore();
  const started = await beginOpenRouterOAuth({
    ownerUsername: 'alice', projectId: 'app', store,
    env: { FORGE_PUBLIC_URL: 'https://forge.example', NODE_ENV: 'production' },
  });
  const state = new URL(new URL(started.authorizeUrl).searchParams.get('callback_url')).searchParams.get('state');
  let fetched = false;
  await assert.rejects(
    completeOpenRouterOAuth({ state, code: 'code', ownerUsername: 'bob', store, fetchFn: async () => { fetched = true; } }),
    /mismatch/,
  );
  assert.equal(fetched, false);
});

function responseRecorder() {
  return {
    statusCode: 200, code: 200, headers: {}, body: null, ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

test('OAuth handler stores the raw key only through the encrypted credential boundary', async () => {
  const stored = [];
  const states = [];
  const handler = createOpenRouterOAuthHandler({
    resolveUser: async () => 'alice',
    complete: async () => ({
      accessToken: 'sk-or-v1-private',
      tenantId: forgeCredentialScope({ ownerUsername: 'alice', projectId: 'app' }),
      projectId: 'app',
      metadata: { key_hash: 'safe-hash' },
    }),
    storeCredential: async (input) => stored.push(input),
    setSlotState: async (input) => states.push(input),
  });
  const res = responseRecorder();
  await handler({ method: 'GET', query: { action: 'callback', state: 'signed', code: 'code', projectId: 'app' } }, res);

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/forge.html?view=brain&connection=success');
  assert.equal(stored[0].accessToken, 'sk-or-v1-private');
  assert.deepEqual(states.map((item) => item.status), ['connected', 'testing', 'ready']);
  assert.equal(JSON.stringify({ headers: res.headers, body: res.body }).includes('sk-or-v1-private'), false);
});

test('room login preserves the allowlisted Forge Builder Brain return URL', async () => {
  const login = await readFile(new URL('../public/room-login.html', import.meta.url), 'utf8');
  assert.match(login, /customerWorkspaces = new Set\(\['\/room\.html', '\/story-studio\.html', '\/forge\.html'\]\)/);
  assert.match(login, /candidate\.pathname\}\$\{candidate\.search\}\$\{candidate\.hash/);
});

test('OpenRouter routing uses the supplied customer key and never reads the owner gateway key', async () => {
  const calls = [];
  const result = await routeOpenRouterStream({
    apiKey: 'customer-openrouter-key',
    body: { system: 'Build it', messages: [{ role: 'user', content: 'A page' }], max_tokens: 4000 },
    env: { AI_GATEWAY_API_KEY: 'owner-key-that-must-not-be-used', FORGE_OPENROUTER_MODEL: 'openrouter/auto' },
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, body: {} };
    },
  });
  assert.equal(result.provider, 'openrouter-user');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer customer-openrouter-key');
  assert.equal(JSON.stringify(calls[0]).includes('owner-key-that-must-not-be-used'), false);
  assert.deepEqual(toOpenRouterRequest({ system: 'S', messages: [{ role: 'user', content: 'U' }] }, 'openrouter/auto').messages, [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U' },
  ]);
});
