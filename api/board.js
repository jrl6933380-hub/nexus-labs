// /api/board.js
// Shared task board endpoint — read/write access for Claude, GPT, and
// Nex to coordinate work without stepping on each other. GET reads
// the whole board (tasks + recent messages + live agent presence);
// POST takes an `action` field to route to the right operation.
//
// Also serves /api/hyperfocus, /api/agentlog, /api/vault,
// /api/tenants, and /api/oauth/:provider/callback (see vercel.json
// rewrites) — folded in here rather than as their own serverless
// functions to stay under the Vercel Hobby plan's 12-function-per-
// deployment cap. Routing is by req.url, not by action name, so the
// action namespaces never collide even though they share this one
// function. This is a deployment-cap workaround, not a design merger:
// the feature areas stay logically separate below, and
// lib/hyperfocus.js / lib/agentLog.js / lib/codeVault.js /
// lib/tenantProvisioning.js (the actual storage/safety logic) are
// completely untouched by this file.

import {
  readBoard,
  createTask,
  claimTask,
  updateProgress,
  markBlocked,
  attachResult,
  completeTask,
  postMessage,
} from '../lib/board.js';
import { listAgents } from '../lib/agents.js';
import { getNexRoleLease, acquireNexRole, renewNexRole, releaseNexRole } from '../lib/roleLease.js';
import {
  startExecution,
  finishExecution,
  checkpointExecution,
  getExecutionResume,
  listExecutionEvents,
} from '../lib/executionLedger.js';
import {
  openHyperfocus,
  publishChatContext,
  readHyperfocus,
  appendHyperfocusDelta,
  closeHyperfocus,
  listActiveHyperfocus,
} from '../lib/hyperfocus.js';
import { logExchange, checkAgentLog } from '../lib/agentLog.js';
import { addVaultItem, getVaultItem, searchVault, listVaultItems } from '../lib/codeVault.js';
import { ingestSentryCrash, listCrashes, getCrash, verifySentrySignature } from '../lib/crashFeed.js';
import { getRequestUser } from '../lib/roomAuth.js';
import { createTenant, listTenantsForOwner, assertTenantAccess, registerConnection } from '../lib/tenantProvisioning.js';
import { tenantMeter } from '../lib/tenantMetering.js';
import { createOAuthState, verifyOAuthState } from '../lib/oauthState.js';
import { requireProvider } from '../lib/oauthProviders.js';
import { storeTenantCredential } from '../lib/tenantCredentials.js';

// This must exactly match the Authorization Callback URL / Redirect
// URL registered with GitHub and Vercel — deriving it from the
// request's Host header instead would break on any preview domain,
// since the OAuth apps only trust this one exact origin.
const NEXUS_PUBLIC_URL = process.env.NEXUS_PUBLIC_URL || 'https://nexus-labs-sigma.vercel.app';

async function handleBoard(req, res) {
  if (req.method === 'GET') {
    const [board, agents, nex_role, crashes] = await Promise.all([readBoard(), listAgents(), getNexRoleLease(), listCrashes({ limit: 200 })]);
    const tasks = board.tasks || [];
    const tasksByStatus = tasks.reduce((counts, task) => {
      counts[task.status] = (counts[task.status] || 0) + 1;
      return counts;
    }, {});
    const telemetry = {
      tasks_by_status: tasksByStatus,
      completed_tasks: tasksByStatus.complete || 0,
      total_tasks: tasks.length,
      needs_approval: tasksByStatus.waiting_for_justin || 0,
      crash_count: crashes.length,
      open_crash_count: crashes.filter((crash) => crash.status !== 'resolved').length,
      active_agents: agents.filter((agent) => ['online', 'busy'].includes(agent.status)).length,
      workspace_status: process.env.E2B_API_KEY ? 'configured' : 'not_configured',
      observed_at: Date.now(),
    };
    return res.status(200).json({ ...board, agents, nex_role, crashes, telemetry });
  }

  if (req.method === 'POST') {
    const { action, ...params } = req.body || {};
    if (!action) return res.status(400).json({ error: 'Missing action' });

    if (action === 'create_task') return res.status(200).json({ task: await createTask(params) });
    if (action === 'claim_task') return res.status(200).json({ task: await claimTask(params) });
    if (action === 'update_progress') return res.status(200).json({ task: await updateProgress(params) });
    if (action === 'mark_blocked') return res.status(200).json({ task: await markBlocked(params) });
    if (action === 'attach_result') return res.status(200).json({ task: await attachResult(params) });
    if (action === 'complete_task') return res.status(200).json({ task: await completeTask(params) });
    if (action === 'post_message') return res.status(200).json({ message: await postMessage(params) });
    if (action === 'acquire_nex_role') return res.status(200).json({ lease: await acquireNexRole(params) });
    if (action === 'renew_nex_role') return res.status(200).json({ lease: await renewNexRole(params) });
    if (action === 'release_nex_role') return res.status(200).json({ lease: await releaseNexRole(params) });
    if (action === 'start_execution') return res.status(200).json(await startExecution(params));
    if (action === 'finish_execution') return res.status(200).json({ event: await finishExecution(params) });
    if (action === 'checkpoint_execution') return res.status(200).json({ pointer: await checkpointExecution(params) });
    if (action === 'get_execution_resume') return res.status(200).json({ pointer: await getExecutionResume(params.run_id) });
    if (action === 'list_execution_events') return res.status(200).json({ events: await listExecutionEvents(params.run_id, params.limit) });

    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}

async function handleHyperfocus(req, res) {
  if (req.method === 'GET') {
    const { focus_id, agent, tenant_id, project_id } = req.query || {};

    if (!focus_id) {
      const focuses = await listActiveHyperfocus();
      return res.status(200).json({ focuses });
    }

    const result = await readHyperfocus({ focus_id, agent, tenant_id, project_id });
    return res.status(200).json(result);
  }

  if (req.method === 'POST') {
    const { action, ...params } = req.body || {};
    if (!action) return res.status(400).json({ error: 'Missing action' });

    if (action === 'open') return res.status(200).json(await openHyperfocus(params));
    if (action === 'publish') return res.status(200).json(await publishChatContext(params));
    if (action === 'append') return res.status(200).json(await appendHyperfocusDelta(params));
    if (action === 'close') return res.status(200).json(await closeHyperfocus(params));

    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}

async function handleAgentLog(req, res) {
  if (req.method === 'GET') {
    const { agent, tenant_id, project_id } = req.query || {};
    if (!agent) return res.status(400).json({ error: 'Missing agent' });
    const result = await checkAgentLog({ agent, tenant_id, project_id });
    return res.status(200).json(result);
  }

  if (req.method === 'POST') {
    const { action, ...params } = req.body || {};
    if (action !== 'log') return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
    const result = await logExchange(params);
    return res.status(200).json(result);
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}


async function handleSentryWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : (typeof req.rawBody === 'string' ? req.rawBody : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})));
  const signature = req.headers?.['sentry-hook-signature'] || req.headers?.['Sentry-Hook-Signature'];
  if (!verifySentrySignature(rawBody, signature)) return res.status(401).json({ error: 'Invalid Sentry signature' });
  let event;
  try { event = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || JSON.parse(rawBody)); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  const crash = await ingestSentryCrash(event);
  return res.status(202).json({ accepted: true, crash: { id: crash.id, count: crash.count, repair_task_id: crash.repair_task_id } });
}

async function handleVault(req, res) {
  if (req.method === 'GET') {
    const { query, level, slug, include_deprecated, limit } = req.query || {};

    if (slug) {
      if (!level) return res.status(400).json({ error: 'level is required when reading by slug' });
      const item = await getVaultItem({ level, slug });
      return res.status(200).json(item || { error: 'Not found' });
    }

    if (query) {
      const results = await searchVault({
        query,
        level,
        include_deprecated: include_deprecated === 'true',
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(200).json({ results });
    }

    const items = await listVaultItems({ level });
    return res.status(200).json({ items });
  }

  if (req.method === 'POST') {
    const { action, ...params } = req.body || {};
    if (action !== 'add') return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
    const result = await addVaultItem(params);
    return res.status(200).json(result);
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}

// /api/tenants — hosted/BYO tenant provisioning (task 09). Ownership
// always comes from the signed-in Room session, never from a
// client-supplied field, so one account can never list, read, or
// modify another account's tenants by passing a different owner in
// the request body.
async function handleTenants(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const ownerUsername = await getRequestUser(req);
  if (!ownerUsername) return res.status(401).json({ error: 'Sign in required' });

  if (req.method === 'GET') {
    const { action, tenant_id, provider } = req.query || {};

    if (action === 'usage') {
      if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });
      try {
        const tenant = await assertTenantAccess({ ownerUsername, tenantId: tenant_id });
        if (!tenant.quota) {
          return res.status(400).json({ error: 'This tenant is BYO and has no managed credit quota.' });
        }
        const usage = await tenantMeter.getUsageSummary({ tenantId: tenant.tenant_id, quota: tenant.quota });
        return res.status(200).json({ usage });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // Export: a tenant's full record (metadata, mode, quota, connection
    // metadata — never credentials, which never live in this record to
    // begin with) as a plain downloadable JSON file. This is the
    // no-lock-in guarantee from task 09's acceptance criteria: nothing
    // about a tenant lives anywhere a downloadable export can't reach.
    // Usage is included best-effort (hosted only) — its absence never
    // blocks the export, since the tenant record itself is the thing
    // that must never be trapped.
    if (action === 'export') {
      if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });
      try {
        const tenant = await assertTenantAccess({ ownerUsername, tenantId: tenant_id });
        let usage = null;
        if (tenant.quota) {
          try {
            usage = await tenantMeter.getUsageSummary({ tenantId: tenant.tenant_id, quota: tenant.quota });
          } catch {
            usage = null;
          }
        }
        const exportPayload = {
          exported_at: new Date().toISOString(),
          export_format_version: 1,
          tenant,
          usage,
        };
        const filename = `nexus-tenant-${tenant.slug}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.status(200).send(JSON.stringify(exportPayload, null, 2));
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // Start a BYO OAuth connection: returns a redirect URL the client
    // navigates the browser to. The signed state token (not the
    // session cookie) is what authorizes the callback that follows,
    // since that request comes back from GitHub/Vercel's own domain.
    if (action === 'oauth_start') {
      if (!tenant_id || !provider) return res.status(400).json({ error: 'tenant_id and provider are required' });
      try {
        const tenant = await assertTenantAccess({ ownerUsername, tenantId: tenant_id });
        if (tenant.mode !== 'byo') {
          return res.status(400).json({ error: 'OAuth connections are only for BYO tenants.' });
        }
        const adapter = requireProvider(provider);
        const state = createOAuthState({ tenant_id: tenant.tenant_id, owner: ownerUsername, provider });
        const redirectUri = `${NEXUS_PUBLIC_URL}/api/oauth/${provider}/callback`;
        const url = adapter.authorizeUrl({ redirectUri, state });
        return res.status(200).json({ url });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const tenants = await listTenantsForOwner({ ownerUsername });
    return res.status(200).json({ tenants });
  }

  if (req.method === 'POST') {
    const { action, ...params } = req.body || {};
    if (!action) return res.status(400).json({ error: 'Missing action' });

    try {
      if (action === 'create') {
        const tenant = await createTenant({ ownerUsername, name: params.name, mode: params.mode });
        return res.status(200).json({ tenant });
      }
      if (action === 'register_connection') {
        const tenant = await registerConnection({
          ownerUsername,
          tenantId: params.tenant_id,
          provider: params.provider,
          metadata: params.metadata,
        });
        return res.status(200).json({ tenant });
      }
      if (action === 'get') {
        const tenant = await assertTenantAccess({ ownerUsername, tenantId: params.tenant_id });
        return res.status(200).json({ tenant });
      }
      return res.status(400).json({ error: `Unknown action: ${action}` });
    } catch (err) {
      // Validation/ownership errors here are expected client mistakes
      // (duplicate name, wrong owner, bad mode, credential-shaped
      // metadata) — 400, not 500, and safe to surface verbatim since
      // tenantProvisioning.js never puts secrets in its own messages.
      return res.status(400).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}

// /api/oauth/:provider/callback — GitHub/Vercel redirect back here
// after the user approves the connection. Authorized by the signed
// state token alone (see oauth_start above), not the session cookie,
// since this request originates from the provider's own domain. On
// success, the access token is encrypted and stored via
// lib/tenantCredentials.js (never returned in this response), and
// lib/tenantProvisioning.js's non-secret connection record is
// updated. Always ends in a redirect back to the tenants page —
// never a raw JSON error a browser would just show as plain text.
async function handleOAuthCallback(req, res, provider) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const { code, state, error: providerError } = req.query || {};
  const redirectBack = (params) => {
    const url = new URL('/tenants.html', NEXUS_PUBLIC_URL);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    res.writeHead(302, { Location: url.pathname + url.search });
    return res.end();
  };

  if (providerError) return redirectBack({ error: `${provider}_denied` });
  if (!code || !state) return redirectBack({ error: 'oauth_missing_params' });

  let payload;
  try {
    payload = verifyOAuthState(state);
  } catch (err) {
    return redirectBack({ error: 'oauth_invalid_state' });
  }
  if (payload.provider !== provider) return redirectBack({ error: 'oauth_provider_mismatch' });

  try {
    const adapter = requireProvider(provider);
    const redirectUri = `${NEXUS_PUBLIC_URL}/api/oauth/${provider}/callback`;
    const { accessToken, refreshToken, expiresAt, metadata } = await adapter.handleCallback({ code, redirectUri });

    await storeTenantCredential({ tenantId: payload.tenant_id, provider, accessToken, refreshToken, expiresAt });
    await registerConnection({
      ownerUsername: payload.owner,
      tenantId: payload.tenant_id,
      provider,
      metadata,
    });

    return redirectBack({ connected: provider });
  } catch (err) {
    console.error(`oauth callback failed for ${provider}:`, err.message);
    return redirectBack({ error: 'oauth_exchange_failed' });
  }
}

export default async function handler(req, res) {
  try {
    // req.url still reflects the ORIGINAL request path even when a
    // vercel.json rewrite sent /api/hyperfocus, /api/agentlog,
    // /api/vault, /api/tenants, or /api/oauth/:provider/callback
    // traffic to this same function — rewrites change which function
    // runs, not what req.url reports. That's what makes routing on it
    // safe here.
    const path = (req.url || '').split('?')[0];
    if (path.startsWith('/api/hyperfocus')) return await handleHyperfocus(req, res);
    if (path.startsWith('/api/agentlog')) return await handleAgentLog(req, res);
    if (path.startsWith('/api/vault')) return await handleVault(req, res);
    if (path.startsWith('/api/sentry-webhook')) return await handleSentryWebhook(req, res);
    if (path.startsWith('/api/tenants')) return await handleTenants(req, res);
    if (path.startsWith('/api/oauth/')) {
      const provider = path.split('/')[3];
      return await handleOAuthCallback(req, res, provider);
    }
    return await handleBoard(req, res);
  } catch (err) {
    console.error('board/hyperfocus/agentlog/vault/tenants/oauth handler crashed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
