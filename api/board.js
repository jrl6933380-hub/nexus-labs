// /api/board.js
// Shared task board endpoint — read/write access for Claude, GPT, and
// Nex to coordinate work without stepping on each other. GET reads
// the whole board (tasks + recent messages + live agent presence);
// POST takes an `action` field to route to the right operation.
//
// Also serves /api/hyperfocus (see vercel.json rewrite) — folded in
// here rather than as its own serverless function to stay under the
// Vercel Hobby plan's 12-function-per-deployment cap. Routing is by
// req.url, not by action name, so the two action namespaces never
// collide even though they share this one function. This is a
// deployment-cap workaround, not a design merger: the two feature
// areas stay logically separate below, and lib/hyperfocus.js (the
// actual storage/safety logic) is completely untouched by this file.

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
import {
  openHyperfocus,
  publishChatContext,
  readHyperfocus,
  appendHyperfocusDelta,
  closeHyperfocus,
  listActiveHyperfocus,
} from '../lib/hyperfocus.js';

async function handleBoard(req, res) {
  if (req.method === 'GET') {
    const [board, agents] = await Promise.all([readBoard(), listAgents()]);
    return res.status(200).json({ ...board, agents });
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

export default async function handler(req, res) {
  try {
    // req.url still reflects the ORIGINAL request path even when a
    // vercel.json rewrite sent /api/hyperfocus traffic to this same
    // function — rewrites change which function runs, not what req.url
    // reports. That's what makes routing on it safe here.
    const isHyperfocus = (req.url || '').split('?')[0].startsWith('/api/hyperfocus');
    if (isHyperfocus) return await handleHyperfocus(req, res);
    return await handleBoard(req, res);
  } catch (err) {
    console.error('board/hyperfocus handler crashed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
