// Provider routing for Nex's Anthropic-compatible message loop.
// Claude stays primary. Vercel AI Gateway is an independent backup that can
// run OpenAI (and optional additional models) through the same Messages API
// shape, so Nex's tools and safety gates do not change when a provider fails.

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const GATEWAY_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/messages';

export const DEFAULT_GATEWAY_MODELS = {
  cheap: 'openai/gpt-5.4-nano',
  standard: 'openai/gpt-5.6-sol',
  heavy: 'openai/gpt-5.6-sol',
};

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_DELEGATE_TIMEOUT_MS = 45_000;

export class AllProvidersUnavailableError extends Error {
  constructor(attempts) {
    super('All configured reasoning providers are temporarily unavailable.');
    this.name = 'AllProvidersUnavailableError';
    this.attempts = attempts;
  }
}

function timeoutMs(env) {
  const requested = Number(env.NEX_PROVIDER_TIMEOUT_MS);
  if (!Number.isFinite(requested)) return DEFAULT_TIMEOUT_MS;
  return Math.max(5_000, Math.min(requested, 90_000));
}

function gatewayModel(tier, env) {
  const key = `NEX_GATEWAY_${String(tier || 'standard').toUpperCase()}_MODEL`;
  return env[key] || DEFAULT_GATEWAY_MODELS[tier] || DEFAULT_GATEWAY_MODELS.standard;
}

function gatewayFallbackModels(env) {
  return String(env.NEX_GATEWAY_FALLBACK_MODELS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function postMessages({ provider, endpoint, headers, body, fetchFn, requestTimeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok || contentType.includes('text/html')) {
      // Read the response so provider diagnostics reach Vercel logs, but keep
      // the public error free of request bodies, prompts, and credentials.
      const responseText = await response.text();
      console.error(
        `${provider} rejected Nex request:`,
        response.status,
        responseText.slice(0, 500)
      );
      throw new Error(`${provider} returned HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one Anthropic Messages-compatible request.
 *
 * The direct Anthropic API is attempted first unless NEX_FORCE_GATEWAY=true.
 * AI Gateway is then attempted with a tier-matched OpenAI model. Tests inject
 * env/fetchFn; production uses process.env and the platform fetch.
 */
export async function routeMessage({
  tier = 'standard',
  claudeModel,
  body,
  env = process.env,
  fetchFn = fetch,
}) {
  const attempts = [];
  const forceGateway = env.NEX_FORCE_GATEWAY === 'true';
  const requestTimeoutMs = timeoutMs(env);

  if (env.ANTHROPIC_API_KEY && !forceGateway) {
    try {
      const data = await postMessages({
        provider: 'anthropic',
        endpoint: ANTHROPIC_ENDPOINT,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: { ...body, model: claudeModel },
        fetchFn,
        requestTimeoutMs,
      });
      return { data, provider: 'anthropic', model: data.model || claudeModel };
    } catch (error) {
      attempts.push({ provider: 'anthropic', error: error.message });
      console.error('Nex primary provider failed; trying AI Gateway:', error.message);
    }
  } else {
    attempts.push({
      provider: 'anthropic',
      error: forceGateway ? 'bypassed by NEX_FORCE_GATEWAY' : 'not configured',
    });
  }

  if (env.AI_GATEWAY_API_KEY) {
    const model = gatewayModel(tier, env);
    const fallbackModels = gatewayFallbackModels(env);
    const providerOptions = fallbackModels.length
      ? { gateway: { models: fallbackModels } }
      : undefined;

    try {
      const data = await postMessages({
        provider: 'vercel-ai-gateway',
        endpoint: GATEWAY_ENDPOINT,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.AI_GATEWAY_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: {
          ...body,
          model,
          ...(providerOptions ? { providerOptions } : {}),
        },
        fetchFn,
        requestTimeoutMs,
      });
      return {
        data,
        provider: 'vercel-ai-gateway',
        model: data.model || model,
      };
    } catch (error) {
      attempts.push({ provider: 'vercel-ai-gateway', error: error.message });
      console.error('Nex backup provider failed:', error.message);
    }
  } else {
    attempts.push({ provider: 'vercel-ai-gateway', error: 'not configured' });
  }

  throw new AllProvidersUnavailableError(attempts);
}

/**
 * Send one Anthropic Messages-compatible request to a SPECIFIC named model
 * through AI Gateway — no tier, no automatic fallback chain, no attempt at
 * Anthropic first. This is for deliberate delegation ("have Llama look at
 * this") rather than reliability routing, so it fails loudly instead of
 * silently trying something else when the named model is unavailable.
 *
 * Reuses the exact same Gateway endpoint and Anthropic-compatible request
 * shape as routeMessage's fallback path — this is not a new provider
 * integration, just an explicit model string instead of a tier lookup.
 * Gateway accepts "creator/model-name" strings, e.g.:
 *   "google/gemini-2.5-flash", "meta/llama-3.3-70b-instruct",
 *   "openai/gpt-5.6-sol", "anthropic/claude-sonnet-4.5".
 *
 * NOTE ON COST: this does not mean the call is free. Whether it is depends
 * entirely on account-level configuration (BYOK in the Vercel AI Gateway
 * dashboard against a provider key that itself has a free tier) that this
 * function has no way to see or control. It only ever reflects the real
 * result Gateway returns.
 */
export async function routeToModel({
  model,
  body,
  env = process.env,
  fetchFn = fetch,
}) {
  if (!model || !String(model).trim()) {
    throw new Error('model is required, e.g. "google/gemini-2.5-flash" or "meta/llama-3.3-70b-instruct"');
  }
  if (!env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is not configured — delegating to a specific model requires the Vercel AI Gateway key.');
  }

  const data = await postMessages({
    provider: `vercel-ai-gateway:${model}`,
    endpoint: GATEWAY_ENDPOINT,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.AI_GATEWAY_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: { ...body, model },
    fetchFn,
    requestTimeoutMs: env.NEX_DELEGATE_TIMEOUT_MS
      ? Math.max(5_000, Math.min(Number(env.NEX_DELEGATE_TIMEOUT_MS) || DEFAULT_DELEGATE_TIMEOUT_MS, 90_000))
      : DEFAULT_DELEGATE_TIMEOUT_MS,
  });

  return { data, provider: 'vercel-ai-gateway', model: data.model || model };
}
