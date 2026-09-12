// Generic, non-secret setup and account links Nex can hand to Justin.
export const REFERENCE_LINKS = {
  claude_usage: ['https://claude.ai/settings/usage', 'Claude subscription usage and reset time.'],
  claude_routines: ['https://claude.ai/code/routines', 'Claude Code Routines and trigger setup.'],
  claude_connectors: ['https://claude.ai/customize/connectors', 'Manage Claude MCP connectors.'],
  anthropic_console: ['https://console.anthropic.com', 'Anthropic developer console.'],
  anthropic_api_keys: ['https://console.anthropic.com/settings/keys', 'Manage Anthropic API keys.'],
  openai_api_keys: ['https://platform.openai.com/api-keys', 'Manage OpenAI API keys.'],
  openai_usage: ['https://platform.openai.com/usage', 'OpenAI API usage.'],
  vercel_dashboard: ['https://vercel.com/dashboard', 'Vercel projects, deployments, and settings.'],
  supabase_dashboard: ['https://supabase.com/dashboard', 'Supabase projects and settings.'],
  upstash_console: ['https://console.upstash.com', 'Upstash Redis databases and REST credentials.'],
  e2b_dashboard: ['https://e2b.dev/dashboard', 'E2B usage, keys, and templates.'],
  github_tokens: ['https://github.com/settings/tokens', 'Manage GitHub access tokens.'],
  sentry_dashboard: ['https://sentry.io', 'Sentry errors and issues.'],
  twilio_console: ['https://console.twilio.com', 'Twilio numbers and webhook settings.'],
  mcp_docs: ['https://modelcontextprotocol.io', 'Model Context Protocol documentation.'],
};

export function getReferenceLink({ topic } = {}) {
  if (!topic) return { available: Object.entries(REFERENCE_LINKS).map(([name, [url, description]]) => ({ topic: name, url, description })) };
  const key = String(topic).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const hit = REFERENCE_LINKS[key];
  if (hit) return { topic: key, url: hit[0], description: hit[1] };
  const needle = key.replace(/_/g, '');
  const did_you_mean = Object.entries(REFERENCE_LINKS)
    .filter(([name, value]) => name.replace(/_/g, '').includes(needle) || value[1].toLowerCase().includes(String(topic).toLowerCase()))
    .map(([name, [url, description]]) => ({ topic: name, url, description }));
  return { error: `No exact match for topic "${topic}".`, did_you_mean, available_topics: did_you_mean.length ? undefined : Object.keys(REFERENCE_LINKS) };
}
