// /lib/workspaceManager.js
// Scoped E2B workspace lifecycle for worker tasks. Only sandbox IDs, snapshot
// references, and bounded metadata are persisted; E2B credentials stay server-side.
//
// SECURITY FIX (task 10): network_allowlist was previously validated and
// stored in the policy but never actually passed to E2B's Sandbox.create() —
// meaning a workspace's "allowlist" had zero real effect on what the
// sandbox could reach over the network. buildSandboxCreateOptions() below
// is the real enforcement, using E2B's documented network.allowOut/denyOut
// mechanism (https://e2b.dev/docs/network/internet-access).

import * as E2B from 'e2b';
import crypto from 'node:crypto';

const Sandbox = E2B.Sandbox || E2B.default;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_COMMANDS = 32;
const MAX_OUTPUT = 20_000;
const WORKSPACE_KEY = 'nexus:workspaces';
const memory = new Map();

function id() { return `ws-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`; }
function required(value, name) { if (!value || typeof value !== 'string') throw new Error(`Missing ${name}`); return value; }
function limit(value, fallback, max) { return Math.max(1_000, Math.min(Number(value) || fallback, max)); }

function policy(input = {}) {
  const tenant_id = required(input.tenant_id, 'tenant_id');
  const project_id = required(input.project_id, 'project_id');
  const task_id = required(input.task_id, 'task_id');
  const agent_id = required(input.agent_id, 'agent_id');
  const network_allowlist = Array.isArray(input.network_allowlist) ? [...new Set(input.network_allowlist.map(String))] : [];
  if (input.public_preview && network_allowlist.length === 0) throw new Error('Public preview requires an explicit network allowlist');
  return {
    tenant_id, project_id, task_id, agent_id,
    template: input.template || 'base',
    timeout_ms: limit(input.timeout_ms, 30_000, MAX_TIMEOUT_MS),
    max_commands: Math.min(Math.max(Number(input.max_commands) || 8, 1), MAX_COMMANDS),
    max_output: Math.min(Math.max(Number(input.max_output) || 10_000, 1_000), MAX_OUTPUT),
    network_allowlist,
    public_preview: Boolean(input.public_preview),
    spend_cap_cents: Math.max(0, Number(input.spend_cap_cents) || 0),
  };
}

function scoped(record, input) {
  return record && record.tenant_id === input.tenant_id &&
    record.project_id === input.project_id && record.task_id === input.task_id &&
    record.agent_id === input.agent_id;
}

// Real enforcement point for network_allowlist. Extracted as a pure,
// directly-testable function rather than only living inline in the
// default sandboxFactory, specifically so a test can verify the actual
// options that would reach Sandbox.create() without needing to mock
// the E2B module import.
//
// When an allowlist is present: allow only those hosts, deny everything
// else — the selector-callback form (({ allTraffic }) => [allTraffic])
// is E2B's documented way to express "all traffic" without importing
// their ALL_TRAFFIC constant.
//
// When no allowlist is set: no `network` field at all, preserving the
// previous (and E2B's default) fully-open behavior for workspaces that
// were never asked to be restricted. This does NOT change behavior for
// existing unrestricted workspaces — it only makes an allowlist that
// IS provided actually do something.
export function buildSandboxCreateOptions(p) {
  const options = { timeoutMs: p.timeout_ms, template: p.template };
  if (p.network_allowlist.length > 0) {
    options.network = {
      allowOut: p.network_allowlist,
      denyOut: ({ allTraffic }) => [allTraffic],
    };
  }
  return options;
}

export function createMemoryWorkspaceStore() {
  return {
    async get(key) { return memory.get(key) || null; },
    async set(key, value) { memory.set(key, value); },
    async delete(key) { memory.delete(key); },
  };
}

export function createRedisWorkspaceStore() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  async function command(command) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Workspace Redis command ${command[0]} failed`);
    return data.result;
  }
  return {
    async get(key) { const raw = await command(['GET', key]); return raw ? JSON.parse(raw) : null; },
    async set(key, value) { await command(['SET', key, JSON.stringify(value)]); },
    async delete(key) { await command(['DEL', key]); },
  };
}

function defaultStore() {
  return process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN ? createRedisWorkspaceStore() : createMemoryWorkspaceStore();
}

export async function createWorkspace(input, { store = defaultStore(), sandboxFactory = null } = {}) {
  const p = policy(input);
  if (input.resume_snapshot_ref && !String(input.resume_snapshot_ref).trim()) throw new Error('Invalid resume_snapshot_ref');
  const create = sandboxFactory || (async () => {
    if (!process.env.E2B_API_KEY) throw new Error('E2B_API_KEY not configured.');
    if (!Sandbox || typeof Sandbox.create !== 'function') throw new Error('Could not resolve E2B Sandbox.');
    return Sandbox.create(buildSandboxCreateOptions(p));
  });
  const sandbox = await create(p);
  const workspace = {
    id: id(), tenant_id: p.tenant_id, project_id: p.project_id, task_id: p.task_id, agent_id: p.agent_id,
    sandbox_id: sandbox?.sandboxId || sandbox?.id || null, snapshot_ref: input.resume_snapshot_ref || null,
    template: p.template, policy: p, state: 'active', artifacts: [], created_at: Date.now(), updated_at: Date.now(),
  };
  await store.set(`${WORKSPACE_KEY}:${workspace.id}`, workspace);
  return { workspace, sandbox };
}

export async function getWorkspace(idValue, scope, { store = defaultStore() } = {}) {
  const workspace = await store.get(`${WORKSPACE_KEY}:${required(idValue, 'workspace_id')}`);
  if (!workspace) return null;
  if (!scoped(workspace, scope)) throw new Error('Workspace scope mismatch');
  return workspace;
}

export async function addArtifact(workspaceId, scope, artifact, { store = defaultStore() } = {}) {
  const workspace = await getWorkspace(workspaceId, scope, { store });
  if (!artifact || !artifact.path) throw new Error('Artifact path is required');
  const safe = { path: String(artifact.path).slice(0, 500), sha256: artifact.sha256 || null, size: Number(artifact.size) || 0, created_at: Date.now() };
  workspace.artifacts = [...workspace.artifacts, safe].slice(-100);
  workspace.updated_at = Date.now();
  await store.set(`${WORKSPACE_KEY}:${workspace.id}`, workspace);
  return safe;
}

export async function checkpointWorkspace(workspaceId, scope, { snapshot_ref, state = 'paused' } = {}, { store = defaultStore() } = {}) {
  const workspace = await getWorkspace(workspaceId, scope, { store });
  if (!snapshot_ref || typeof snapshot_ref !== 'string') throw new Error('snapshot_ref is required');
  workspace.snapshot_ref = snapshot_ref;
  workspace.state = state;
  workspace.updated_at = Date.now();
  await store.set(`${WORKSPACE_KEY}:${workspace.id}`, workspace);
  return workspace;
}

export async function closeWorkspace(workspaceId, scope, { sandbox = null, state = 'closed' } = {}, { store = defaultStore() } = {}) {
  const workspace = await getWorkspace(workspaceId, scope, { store });
  if (sandbox && typeof sandbox.kill === 'function') await sandbox.kill();
  workspace.state = state;
  workspace.updated_at = Date.now();
  await store.set(`${WORKSPACE_KEY}:${workspace.id}`, workspace);
  return workspace;
}

export const __internals = { policy, scoped, MAX_TIMEOUT_MS, MAX_COMMANDS };
