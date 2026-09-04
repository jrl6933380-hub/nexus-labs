import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AllProvidersUnavailableError,
  routeMessage,
  routeToModel,
} from '../lib/modelRouter.js';

function response({ ok = true, status = 200, json = {}, text = '' } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => json,
    text: async () => text,
  };
}

test('uses direct Anthropic first when it is healthy', async () => {
  const calls = [];
  const result = await routeMessage({
    tier: 'standard',
    claudeModel: 'claude-test',
    body: { messages: [] },
    env: { ANTHROPIC_API_KEY: 'anthropic-key', AI_GATEWAY_API_KEY: 'gateway-key' },
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return response({ json: { model: 'claude-test', content: [] } });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(result.provider, 'anthropic');
});

test('falls back to Vercel AI Gateway when Anthropic fails', async () => {
  const calls = [];
  const result = await routeMessage({
    tier: 'standard',
    claudeModel: 'claude-test',
    body: { messages: [] },
    env: { ANTHROPIC_API_KEY: 'anthropic-key', AI_GATEWAY_API_KEY: 'gateway-key' },
    fetchFn: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (url.includes('api.anthropic.com')) {
        return response({ ok: false, status: 429, text: 'rate limited' });
      }
      return response({ json: { model: 'openai/gpt-5.4-nano', content: [] } });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://ai-gateway.vercel.sh/v1/messages');
  assert.equal(calls[1].body.model, 'openai/gpt-5.4-nano');
  assert.equal(result.provider, 'vercel-ai-gateway');
});

test('force-gateway switch bypasses Anthropic without removing its key', async () => {
  const calls = [];
  await routeMessage({
    tier: 'cheap',
    claudeModel: 'claude-test',
    body: { messages: [] },
    env: {
      ANTHROPIC_API_KEY: 'anthropic-key',
      AI_GATEWAY_API_KEY: 'gateway-key',
      NEX_FORCE_GATEWAY: 'true',
    },
    fetchFn: async (url) => {
      calls.push(url);
      return response({ json: { model: 'openai/gpt-5.4-nano', content: [] } });
    },
  });

  assert.deepEqual(calls, ['https://ai-gateway.vercel.sh/v1/messages']);
});

test('reports safe-mode condition when every provider is unavailable', async () => {
  await assert.rejects(
    routeMessage({
      tier: 'standard',
      claudeModel: 'claude-test',
      body: { messages: [] },
      env: {},
      fetchFn: async () => {
        throw new Error('should not be called');
      },
    }),
    (error) =>
      error instanceof AllProvidersUnavailableError &&
      error.attempts.length === 2
  );
});

test('REGRESSION: routeToModel sends the exact named model to Gateway, skipping Anthropic entirely', async () => {
  const calls = [];
  const result = await routeToModel({
    model: 'meta/llama-3.3-70b-instruct',
    body: { messages: [{ role: 'user', content: 'hi' }], max_tokens: 512 },
    env: { ANTHROPIC_API_KEY: 'anthropic-key', AI_GATEWAY_API_KEY: 'gateway-key' },
    fetchFn: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return response({ json: { model: 'meta/llama-3.3-70b-instruct', content: [{ type: 'text', text: 'hello' }] } });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ai-gateway.vercel.sh/v1/messages');
  assert.equal(calls[0].body.model, 'meta/llama-3.3-70b-instruct');
  assert.equal(result.provider, 'vercel-ai-gateway');
  assert.equal(result.model, 'meta/llama-3.3-70b-instruct');
});

test('routeToModel fails loudly instead of falling back when the named model errors', async () => {
  await assert.rejects(
    routeToModel({
      model: 'google/gemini-2.5-flash',
      body: { messages: [] },
      env: { AI_GATEWAY_API_KEY: 'gateway-key' },
      fetchFn: async () => response({ ok: false, status: 404, text: 'model not found' }),
    }),
    /HTTP 404/
  );
});

test('routeToModel requires a model name', async () => {
  await assert.rejects(
    routeToModel({ body: {}, env: { AI_GATEWAY_API_KEY: 'gateway-key' }, fetchFn: async () => response() }),
    /model is required/
  );
});

test('routeToModel requires Gateway to be configured', async () => {
  await assert.rejects(
    routeToModel({ model: 'google/gemini-2.5-flash', body: {}, env: {}, fetchFn: async () => response() }),
    /AI_GATEWAY_API_KEY is not configured/
  );
});
