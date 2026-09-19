const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function appUrl(env) {
  let value = env.FORGE_PUBLIC_URL || env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || '';
  if (value && !/^https?:\/\//i.test(value)) value = 'https://' + value;
  try { return value ? new URL(value).origin : ''; } catch { return ''; }
}

export function toOpenRouterRequest(body = {}, model) {
  const messages = [];
  if (typeof body.system === 'string' && body.system.trim()) {
    messages.push({ role: 'system', content: body.system });
  }
  for (const message of body.messages || []) {
    messages.push({ role: message.role, content: message.content });
  }
  return {
    model,
    messages,
    max_tokens: body.max_tokens,
    stream: true,
  };
}

export async function routeOpenRouterStream({
  apiKey,
  body,
  model,
  env = process.env,
  fetchFn = fetch,
  signal,
} = {}) {
  if (!apiKey) throw new Error('A customer OpenRouter connection is required.');
  const selectedModel = model || env.FORGE_OPENROUTER_MODEL || 'openrouter/free';
  const headers = {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'X-OpenRouter-Title': 'Nexus Forge',
  };
  const referer = appUrl(env);
  if (referer) headers['HTTP-Referer'] = referer;

  const response = await fetchFn(OPENROUTER_URL, {
    method: 'POST', headers, body: JSON.stringify(toOpenRouterRequest(body, selectedModel)), signal,
  });
  if (!response.ok) throw new Error('OpenRouter build request failed with status ' + response.status + '.');
  return { response, provider: 'openrouter-user', model: selectedModel };
}

export const __internals = { appUrl, OPENROUTER_URL };
