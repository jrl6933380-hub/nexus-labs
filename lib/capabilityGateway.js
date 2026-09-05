// /lib/capabilityGateway.js
// Server-side capability authorization boundary. Models and MCP callers receive
// short-lived signed grants; raw provider credentials never cross this module.

import crypto from 'node:crypto';

const AUDIT_KEY = 'nexus:capability:audit';
const MAX_GRANT_MS = 15 * 60 * 1000;
const WRITE_ACTIONS = new Set(['create_file', 'update_file', 'delete_file', 'commit', 'deploy', 'delete']);

function b64(value) { return Buffer.from(value).toString('base64url'); }
function unb64(value) { return Buffer.from(value, 'base64url').toString('utf8'); }
function secret() { return process.env.NEXUS_GRANT_SIGNING_SECRET || ''; }
function sign(value) {
  if (!secret()) throw new Error('NEXUS_GRANT_SIGNING_SECRET is not configured');
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}
function constantTimeEqual(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function scopeMatches(grantValue, requested) {
  return grantValue === '*' || grantValue === requested;
}

export function issueCapabilityGrant({
  tenant_id, project_id, task_id, agent_id, tool, action, resource = '*',
  read_write = 'read', ttl_ms = 5 * 60 * 1000, approval_id = null,
} = {}) {
  if (!tenant_id || !project_id || !task_id || !agent_id || !tool || !action) {
    throw new Error('tenant_id, project_id, task_id, agent_id, tool, and action are required');
  }
  if (!['read', 'write'].includes(read_write)) throw new Error('read_write must be read or write');
  const now = Date.now();
  const exp = now + Math.max(30_000, Math.min(Number(ttl_ms) || 300_000, MAX_GRANT_MS));
  const payload = {
    v: 1, tenant_id, project_id, task_id, agent_id, tool, action, resource,
    read_write, approval_id, iat: now, exp,
  };
  const encoded = b64(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyCapabilityGrant(token, requested = {}) {
  if (!token || typeof token !== 'string') throw new Error('Missing Nexus capability grant');
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || !constantTimeEqual(sign(encoded), signature)) {
    throw new Error('Invalid Nexus capability grant');
  }
  let grant;
  try { grant = JSON.parse(unb64(encoded)); } catch { throw new Error('Malformed Nexus capability grant'); }
  if (grant.exp <= Date.now()) throw new Error('Expired Nexus capability grant');
  for (const key of ['tenant_id', 'project_id', 'task_id', 'agent_id', 'tool', 'action']) {
    if (requested[key] && !scopeMatches(grant[key], requested[key])) throw new Error(`Grant scope mismatch: ${key}`);
  }
  if (requested.resource && !scopeMatches(grant.resource, requested.resource)) throw new Error('Grant scope mismatch: resource');
  if (requested.read_write === 'write' && grant.read_write !== 'write') throw new Error('Read-only grant cannot perform write action');
  if (WRITE_ACTIONS.has(requested.action) && !grant.approval_id) throw new Error('Write capability requires an approval_id');
  return grant;
}

export function capabilityGatewayRequired() {
  return process.env.NEXUS_CAPABILITY_GATEWAY_REQUIRED === 'true';
}

async function redisAudit(entry) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: ['LPUSH', AUDIT_KEY, JSON.stringify(entry)] }),
  });
}

export async function recordCapabilityUse(grant, { result = 'completed', error = null } = {}) {
  const entry = {
    at: Date.now(), actor_agent: grant?.agent_id || null, tenant_id: grant?.tenant_id || null,
    project_id: grant?.project_id || null, task_id: grant?.task_id || null,
    tool: grant?.tool || null, action: grant?.action || null, resource: grant?.resource || null,
    result, error: error ? String(error).slice(0, 300) : null,
  };
  try { await redisAudit(entry); } catch (err) { console.error('capability audit failed:', err.message); }
  return entry;
}

export async function authorizeCapability(req, scope) {
  const token = req.headers?.['x-nexus-capability-grant'] || req.headers?.['x-nexus-grant'];
  if (!capabilityGatewayRequired() && !token) return { legacy: true, grant: null };
  const grant = verifyCapabilityGrant(token, scope);
  await recordCapabilityUse(grant, { result: 'authorized' });
  return { legacy: false, grant };
}
