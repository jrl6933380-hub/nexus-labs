import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AllProvidersUnavailableError,
  routeMessage,
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
      return response({ json: { model: 'openai/gpt-5.6-sol', content: [] } });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://ai-gateway.vercel.sh/v1/messages');
  assert.equal(calls[1].body.model, 'openai/gpt-5.6-sol');
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
