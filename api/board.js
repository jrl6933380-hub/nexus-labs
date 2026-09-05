// /api/board.js
// Shared task board endpoint — read/write access for Claude, GPT, and
// Nex to coordinate work without stepping on each other. GET reads
// the whole board (tasks + recent messages + live agent presence);
// POST takes an `action` field to route to the right operation.
//
// Also serves /api/hyperfocus, /api/agentlog, and /api/vault (see
// vercel.json rewrites) — folded in here rather than as their own
// serverless functions to stay under the Vercel Hobby plan's
// 12-function-per-deployment cap. Routing is by req.url, not by
// action name, so the action namespaces never collide even though
// they share this one function. This is a deployment-cap workaround,
// not a design merger: the feature areas stay logically separate
// below, and lib/hyperfocus.js / lib/agentLog.js / lib/codeVault.js
// (the actual storage/safety logic) are completely untouched by this
// file.

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

async function handleBoard(req, res) {
  if (req.method === 'GET') {
    const [board, agents, nex_role] = await Promise.all([readBoard(), listAgents(), getNexRoleLease()]);
    return res.status(200).json({ ...board, agents, nex_role });
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

export default async function handler(req, res) {
  try {
    // req.url still reflects the ORIGINAL request path even when a
    // vercel.json rewrite sent /api/hyperfocus, /api/agentlog, or
    // /api/vault traffic to this same function — rewrites change
    // which function runs, not what req.url reports. That's what
    // makes routing on it safe here.
    const path = (req.url || '').split('?')[0];
    if (path.startsWith('/api/hyperfocus')) return await handleHyperfocus(req, res);
    if (path.startsWith('/api/agentlog')) return await handleAgentLog(req, res);
    if (path.startsWith('/api/vault')) return await handleVault(req, res);
    if (path.startsWith('/api/sentry-webhook')) return await handleSentryWebhook(req, res);
    return await handleBoard(req, res);
  } catch (err) {
    console.error('board/hyperfocus/agentlog/vault handler crashed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
