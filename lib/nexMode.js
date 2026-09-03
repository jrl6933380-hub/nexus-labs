// Persistent chat ownership mode. Disengage pauses Nex's visible chat
// endpoint; it does not revoke Claude Code's independently authorized tools.

const MODE_KEY = 'nex:chat-mode';
const DEFAULT_TTL_SECONDS = 86400;

function getConfig() {
  return {
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  };
}

async function command(cmd, { fetchImpl = fetch } = {}) {
  const { url, token } = getConfig();
  if (!url || !token) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Nex mode Redis command failed: ${cmd[0]}`);
  return data.result;
}

export async function getNexChatMode(options = {}) {
  const raw = await command(['GET', MODE_KEY], options);
  return raw ? JSON.parse(raw) : { mode: 'engaged' };
}

export async function disengageNex({ session_url, task_id }, options = {}) {
  const value = {
    mode: 'disengaged',
    session_url,
    task_id,
    disengaged_at: Date.now(),
  };
  await command(['SET', MODE_KEY, JSON.stringify(value), 'EX', String(DEFAULT_TTL_SECONDS)], options);
  return value;
}

export async function engageNex(options = {}) {
  await command(['DEL', MODE_KEY], options);
  return { mode: 'engaged' };
}

