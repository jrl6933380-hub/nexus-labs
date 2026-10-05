// /lib/roleLease.js
// Provider-neutral role leases for the shared Board. A worker may temporarily
// assume the Nex orchestrator role without changing its truthful provider/model
// identity or approval boundary. The lease is server-side and expires safely.

import { listAgents } from './agents.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const NEX_ROLE_KEY = 'nexus:role-lease:nex';
const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const MAX_LEASE_MS = 60 * 60 * 1000;
const VALID_APPROVAL_BOUNDARIES = ['same_as_nex', 'read_only', 'scoped'];

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Role lease Redis command ${command[0]} failed`);
  return data.result;
}

function leaseMs(value) {
  return Math.max(60_000, Math.min(Number(value) || DEFAULT_LEASE_MS, MAX_LEASE_MS));
}

function normalizeLease(lease, now = Date.now()) {
  if (!lease || typeof lease !== 'object') return null;
  if (Number(lease.expires_at || 0) <= now) return null;
  return { ...lease, role: 'nex', active: true };
}

export function validateRoleLeaseInput({ agent_id, provider, model, approval_boundary = 'same_as_nex' }) {
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(agent_id || '')) throw new Error('agent_id is required');
  if (agent_id === 'nex') throw new Error('The permanent Nex agent cannot lease its own role');
  if (!provider || !model) throw new Error('provider and model are required for provenance');
  if (!VALID_APPROVAL_BOUNDARIES.includes(approval_boundary)) throw new Error('Invalid approval_boundary');
}

export async function getNexRoleLease() {
  const raw = await redisCommand(['GET', NEX_ROLE_KEY]);
  if (!raw) return null;
  try { return normalizeLease(JSON.parse(raw)); } catch { return null; }
}

export async function acquireNexRole({
  agent_id,
  provider,
  model,
  lease_ms,
  task_id = null,
  checkpoint_id = null,
  approval_boundary = 'same_as_nex',
}) {
  validateRoleLeaseInput({ agent_id, provider, model, approval_boundary });
  const agents = await listAgents();
  const agent = agents.find((candidate) => candidate.id === agent_id);
  if (!agent) throw new Error(`Agent not found: ${agent_id}`);
  if (!['online', 'available_on_demand'].includes(agent.status)) {
    throw new Error(`Agent is not eligible: ${agent_id}`);
  }
  if (!agent.capabilities.includes('orchestration')) {
    throw new Error('Agent lacks orchestration capability');
  }

  const now = Date.now();
  const expires_at = now + leaseMs(lease_ms);
  const lease = {
    role: 'nex',
    actor_agent: agent_id,
    provider,
    model,
    task_id,
    checkpoint_id,
    approval_boundary,
    acquired_at: now,
    expires_at,
  };
  const stored = await redisCommand(['SET', NEX_ROLE_KEY, JSON.stringify(lease), 'NX', 'PX', String(expires_at - now)]);
  if (stored !== 'OK') throw new Error('Nex role is already leased');
  return { ...lease, active: true };
}

export async function renewNexRole({ agent_id, lease_ms, checkpoint_id = null }) {
  const current = await getNexRoleLease();
  if (!current || current.actor_agent !== agent_id) throw new Error('Active Nex role lease not held by agent');
  const now = Date.now();
  const expires_at = now + leaseMs(lease_ms);
  const next = { ...current, checkpoint_id: checkpoint_id || current.checkpoint_id, expires_at };
  await redisCommand(['SET', NEX_ROLE_KEY, JSON.stringify(next), 'XX', 'PX', String(expires_at - now)]);
  return { ...next, active: true };
}

export async function releaseNexRole({ agent_id, checkpoint_id = null }) {
  const current = await getNexRoleLease();
  if (!current || current.actor_agent !== agent_id) throw new Error('Active Nex role lease not held by agent');
  const released = { ...current, active: false, released_at: Date.now(), checkpoint_id: checkpoint_id || current.checkpoint_id };
  await redisCommand(['DEL', NEX_ROLE_KEY]);
  return released;
}
