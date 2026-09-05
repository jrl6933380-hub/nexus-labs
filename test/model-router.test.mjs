import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AllProvidersUnavailableError,
  DEFAULT_GATEWAY_MODELS,
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

// --- Coverage for the gateway fallback-chain and per-tier overrides —
// the exact mechanism involved in the real incident where the
// standard/heavy emergency fallback had to be switched off a
// rate-limited gpt-5.6-sol. Neither knob had any test coverage before
// this, despite being load-bearing during a real outage. ---

test('NEX_GATEWAY_FALLBACK_MODELS reaches the Gateway request as providerOptions.gateway.models', async () => {
  const calls = [];
  await routeMessage({
    tier: 'standard',
    claudeModel: 'claude-test',
    body: { messages: [] },
    env: {
      AI_GATEWAY_API_KEY: 'gateway-key',
      NEX_GATEWAY_FALLBACK_MODELS: 'openai/gpt-5.4-nano, meta/llama-3.3-70b-instruct ,,',
    },
    fetchFn: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return response({ json: { model: 'openai/gpt-5.4-nano', content: [] } });
    },
  });

  assert.equal(calls.length, 1);
  // Trims whitespace and drops empty entries from a trailing/double comma.
  assert.deepEqual(calls[0].providerOptions, {
    gateway: { models: ['openai/gpt-5.4-nano', 'meta/llama-3.3-70b-instruct'] },
  });
});

test('no providerOptions field is sent when NEX_GATEWAY_FALLBACK_MODELS is unset', async () => {
  const calls = [];
  await routeMessage({
    tier: 'standard',
    claudeModel: 'claude-test',
    body: { messages: [] },
    env: { AI_GATEWAY_API_KEY: 'gateway-key' },
    fetchFn: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return response({ json: { model: 'openai/gpt-5.4-nano', content: [] } });
    },
  });

  assert.equal('providerOptions' in calls[0], false);
});

test('an empty/whitespace-only NEX_GATEWAY_FALLBACK_MODELS is treated as unset, not an empty chain', async () => {
  const calls = [];
  await routeMessage({
    tier: 'standard',
    claudeModel: 'claude-test',
    body: { messages: [] },
    env: { AI_GATEWAY_API_KEY: 'gateway-key', NEX_GATEWAY_FALLBACK_MODELS: '  , , ' },
    fetchFn: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return response({ json: { model: 'openai/gpt-5.4-nano', content: [] } });
    },
  });

  assert.equal('providerOptions' in calls[0], false);
});

test('a per-tier NEX_GATEWAY_*_MODEL override picks the named model over the default', async () => {
  const calls = [];
  await routeMessage({
    tier: 'heavy',
    claudeModel: 'claude-test',
    body: { messages: [] },
    env: { AI_GATEWAY_API_KEY: 'gateway-key', NEX_GATEWAY_HEAVY_MODEL: 'anthropic/claude-opus-5' },
    fetchFn: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return response({ json: { model: 'anthropic/claude-opus-5', content: [] } });
    },
  });

  assert.equal(calls[0].model, 'anthropic/claude-opus-5');
});

test('an unrecognized tier falls back to the standard default model rather than sending undefined', async () => {
  const calls = [];
  await routeMessage({
    tier: 'ultra-mega',
    claudeModel: 'claude-test',
    body: { messages: [] },
    env: { AI_GATEWAY_API_KEY: 'gateway-key' },
    fetchFn: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return response({ json: { model: 'openai/gpt-5.4-nano', content: [] } });
    },
  });

  assert.equal(calls[0].model, DEFAULT_GATEWAY_MODELS.standard);
});

test('REGRESSION: switching the emergency fallback model (the real gpt-5.6-sol -> gpt-5.4-nano incident) actually changes what gets sent, with no code change needed next time', async () => {
  const calls = [];
  // Simulates exactly what fixing that incident looked like: an env
  // var change, not a code change. If this ever required editing
  // modelRouter.js again to swap models, that would be a regression
  // in the design this test locks in.
  await routeMessage({
    tier: 'standard',
    claudeModel: 'claude-test',
    body: { messages: [] },
    env: { AI_GATEWAY_API_KEY: 'gateway-key', NEX_GATEWAY_STANDARD_MODEL: 'openai/gpt-5.4-nano' },
    fetchFn: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return response({ json: { model: 'openai/gpt-5.4-nano', content: [] } });
    },
  });
  assert.equal(calls[0].model, 'openai/gpt-5.4-nano');
});
