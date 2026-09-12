const LINKS = {
  claude_usage: ['https://claude.ai/settings/usage', 'Claude subscription usage and reset time.'],
  claude_routines: ['https://claude.ai/code/routines', 'Claude Code Routines and trigger management.'],
  claude_connectors: ['https://claude.ai/customize/connectors', 'Manage Claude MCP connectors.'],
  anthropic_console: ['https://console.anthropic.com', 'Anthropic developer console.'],
  anthropic_api_keys: ['https://console.anthropic.com/settings/keys', 'Create or revoke Anthropic API keys.'],
  anthropic_api_usage: ['https://console.anthropic.com/settings/usage', 'Anthropic API usage and spend.'],
  openai_api_keys: ['https://platform.openai.com/api-keys', 'Create or revoke OpenAI API keys.'],
  openai_usage: ['https://platform.openai.com/usage', 'OpenAI API usage and spend.'],
  vercel_dashboard: ['https://vercel.com/dashboard', 'Vercel projects, deployments, and settings.'],
  supabase_dashboard: ['https://supabase.com/dashboard', 'Supabase projects and database settings.'],
  upstash_console: ['https://console.upstash.com', 'Upstash Redis databases and credentials.'],
  e2b_dashboard: ['https://e2b.dev/dashboard', 'E2B sandbox usage, keys, and templates.'],
  github_tokens: ['https://github.com/settings/tokens', 'GitHub personal access tokens.'],
  sentry_dashboard: ['https://sentry.io', 'Sentry error monitoring.'],
  twilio_console: ['https://console.twilio.com', 'Twilio numbers and webhook settings.'],
  mcp_docs: ['https://modelcontextprotocol.io', 'Model Context Protocol documentation.'],
};

export function getReferenceLink({ topic } = {}) {
  const entries = Object.entries(LINKS).map(([name, [url, description]]) => ({ topic: name, url, description }));
  if (!topic) return { available: entries };
  const key = String(topic).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const exact = entries.find((entry) => entry.topic === key);
  if (exact) return exact;
  const needle = key.replace(/_/g, '');
  const candidates = entries.filter((entry) => entry.topic.replace(/_/g, '').includes(needle) || entry.description.toLowerCase().includes(String(topic).toLowerCase()));
  return { error: `No exact match for topic "${topic}".`, did_you_mean: candidates.length ? candidates : undefined, available_topics: candidates.length ? undefined : entries.map((entry) => entry.topic) };
}
