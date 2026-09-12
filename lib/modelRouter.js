// Provider routing for Nex's Anthropic-compatible message loop.
// Claude stays primary. Vercel AI Gateway is an independent backup that can
// run OpenAI (and optional additional models) through the same Messages API
// shape, so Nex's tools and safety gates do not change when a provider fails.

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const GATEWAY_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/messages';

// Gateway tier mapping.
//
// These were previously all pinned to the same cheapest model because the
// Gateway account could not invoke anything better. That is no longer true —
// the account has credits — and the pinning had a real cost: any Anthropic
// hiccup silently dropped EVERY request, including code work and Story
// Studio generation, onto a nano-class model. The visible symptom was Nex
// suddenly getting vague and losing track of context mid-session.
//
// Deliberate choice: these defaults are NOT Anthropic models. This map is
// only ever reached after the direct Anthropic call already failed, and a
// large share of those failures are upstream (Anthropic API degraded or
// rate-limiting) rather than local. Falling back to anthropic/* through
// Gateway would route straight back into the provider that just failed.
// A genuine backup has to be a different house.
//
// Every entry stays overridable via NEX_GATEWAY_<TIER>_MODEL so a model can
// be swapped without a deploy if a name changes or a provider degrades.
export const DEFAULT_GATEWAY_MODELS = {
  // Trivial, high-volume work: classification, short summaries, routing
  // decisions. Still a real model, just not an expensive one.
  cheap: 'google/gemini-2.5-flash',
  // Normal conversational and reasoning work.
  standard: 'openai/gpt-5.6-sol',
  // Code, architecture, and anything where being wrong is expensive.
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
 * AI Gateway is then attempted with a tier-matched model. Tests inject
 * env/fetchFn; production uses process.env and the platform fetch.
 *
 * Returns { data, provider, model, degraded } — `degraded` is true when the
 * answer came from the backup path rather than the primary. Callers that
 * surface responses to a human should pass that through: silently serving a
 * fallback answer as if nothing happened is how a provider outage turns into
 * "why is Nex suddenly dumb?" with no visible cause.
 */
function withCacheBreakpoint(list) {
  if (!Array.isArray(list) || !list.length) return list;
  const marked = list.slice(0, -1);
  marked.push({ ...list[list.length - 1], cache_control: { type: 'ephemeral' } });
  return marked;
}

// Anthropic prompt caching: a cache_control breakpoint tells Anthropic
// "everything up through here is stable, reuse it instead of
// reprocessing." Nex's system prompt runs thousands of words (identity,
// board coordination, billing-action rules, hyperfocus, scoped-approval
// policy) and TOOLS carries 30+ full schemas — both are identical on
// nearly every call, so both get a breakpoint. Below Anthropic's
// minimum cacheable size this is silently a no-op, never an error, so
// it's safe to always apply.
function applyCaching(body) {
  const cachedSystem = typeof body.system === 'string'
    ? [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }]
    : body.system;
  return { ...body, system: cachedSystem, tools: withCacheBreakpoint(body.tools || []) };
}

export async function routeMessage({
  tier = 'standard',
  claudeModel,
  body,
  env = process.env,
  fetchFn = fetch,
  // Tool defs that only make sense on a direct Anthropic call (e.g.
  // Anthropic's native web_search/web_fetch server tools) — merged
  // into the Anthropic request's tools array, left out of the Gateway
  // request entirely, since a Gateway model wouldn't understand them.
  anthropicServerTools = [],
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
          // Required for the web_fetch server tool specifically; harmless
          // to send even on requests that only use web_search or neither.
          'anthropic-beta': 'web-fetch-2025-09-10',
        },
        body: applyCaching({
          ...body,
          model: claudeModel,
          tools: [...(body.tools || []), ...anthropicServerTools],
        }),
        fetchFn,
        requestTimeoutMs,
      });
      return { data, provider: 'anthropic', model: data.model || claudeModel, degraded: false };
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
        degraded: true,
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
