// /lib/agents.js
// Workspace-scoped dynamic agent registry. Nex and Cleaner are permanent
// Nexus services; external models appear only when connected and are routed
// by capability.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const AGENTS_KEY = 'nexus:agents';
const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const VALID_MODES = ['permanent', 'service', 'api', 'subscription_connector'];
const VALID_STATES = ['idle', 'busy', 'disabled'];

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Agent registry Redis command ${command[0]} failed`);
  return data.result;
}

export function computeAgentStatus(agent, now = Date.now()) {
  if (agent.mode === 'permanent' || agent.mode === 'service') return agent.state === 'disabled' ? 'disabled' : 'online';
  if (agent.state === 'disabled') return 'disabled';
  if ((agent.lease_expires_at || 0) > now) return agent.state === 'busy' ? 'busy' : 'online';
  if (agent.mode === 'subscription_connector') return 'available_on_demand';
  return 'offline';
}

function normalizeAgent(agent, now = Date.now()) {
  return {
    ...agent,
    capabilities: Array.isArray(agent.capabilities) ? [...new Set(agent.capabilities)] : [],
    status: computeAgentStatus(agent, now),
  };
}

export function permanentNex() {
  return normalizeAgent({
    id: 'nex',
    provider: 'nexus',
    display_name: 'Nex',
    model_type: 'orchestrator',
    mode: 'permanent',
    state: 'idle',
    capabilities: ['orchestration', 'planning', 'coding', 'review', 'memory', 'routing'],
    last_seen: Date.now(),
    lease_expires_at: null,
  });
}

// Cleaner is deliberately deterministic, not an LLM with repository access.
// Its job is to surface stale/duplicated/incomplete board state on schedule.
export function permanentCleaner() {
  return normalizeAgent({
    id: 'cleaner',
    provider: 'nexus',
    display_name: 'Cleaner',
    model_type: 'maintenance_service',
    mode: 'service',
    state: 'idle',
    capabilities: ['board_hygiene', 'stale_task_detection', 'duplicate_detection', 'claim_verification'],
    last_seen: Date.now(),
    lease_expires_at: null,
    approval_boundary: 'read_only',
  });
}

export async function listAgents() {
  try {
    const raw = await redisCommand(['HGETALL', AGENTS_KEY]);
    const agents = [permanentNex(), permanentCleaner()];
    for (let i = 0; Array.isArray(raw) && i < raw.length; i += 2) {
      try {
        const agent = JSON.parse(raw[i + 1]);
        if (agent.id !== 'nex' && agent.id !== 'cleaner') agents.push(normalizeAgent(agent));
      } catch {
        // Skip malformed external records without hiding Nexus services.
      }
    }
    return agents;
  } catch (err) {
    console.error('listAgents failed:', err.message);
    return [permanentNex(), permanentCleaner()];
  }
}

export async function registerAgent({
  id,
  provider,
  display_name,
  model_type,
  mode = 'subscription_connector',
  capabilities = [],
  lease_ms = DEFAULT_LEASE_MS,
}) {
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id || '') || ['nex', 'cleaner'].includes(id)) {
    throw new Error('Invalid or reserved agent id');
  }
  if (!VALID_MODES.includes(mode) || ['permanent', 'service'].includes(mode)) throw new Error('Invalid external agent mode');
  const now = Date.now();
  const agent = {
    id,
    provider: provider || 'unknown',
    display_name: display_name || id,
    model_type: model_type || 'general',
    mode,
    state: 'idle',
    capabilities: [...new Set(capabilities.map((value) => String(value).trim().toLowerCase()).filter(Boolean))],
    last_seen: now,
    lease_expires_at: now + Math.max(60_000, Math.min(Number(lease_ms) || DEFAULT_LEASE_MS, 60 * 60 * 1000)),
  };
  await redisCommand(['HSET', AGENTS_KEY, id, JSON.stringify(agent)]);
  return normalizeAgent(agent, now);
}

export async function heartbeatAgent({ id, state = 'idle', lease_ms = DEFAULT_LEASE_MS }) {
  if (!VALID_STATES.includes(state)) throw new Error('Invalid agent state');
  const raw = await redisCommand(['HGET', AGENTS_KEY, id]);
  if (!raw) throw new Error(`Agent not found: ${id}`);
  const agent = JSON.parse(raw);
  const now = Date.now();
  agent.state = state;
  agent.last_seen = now;
  agent.lease_expires_at = now + Math.max(60_000, Math.min(Number(lease_ms) || DEFAULT_LEASE_MS, 60 * 60 * 1000));
  await redisCommand(['HSET', AGENTS_KEY, id, JSON.stringify(agent)]);
  return normalizeAgent(agent, now);
}

export async function disableAgent({ id }) {
  const raw = await redisCommand(['HGET', AGENTS_KEY, id]);
  if (!raw) throw new Error(`Agent not found: ${id}`);
  const agent = JSON.parse(raw);
  agent.state = 'disabled';
  agent.updated_at = Date.now();
  await redisCommand(['HSET', AGENTS_KEY, id, JSON.stringify(agent)]);
  return normalizeAgent(agent);
}

export function chooseAgent(agents, capability, preferredAgent = null) {
  const usable = agents.filter((agent) =>
    ['online', 'available_on_demand'].includes(agent.status) &&
    (!capability || agent.capabilities.includes(capability))
  );
  return usable.find((agent) => agent.id === preferredAgent) || usable[0] || agents.find((agent) => agent.id === 'nex');
}
