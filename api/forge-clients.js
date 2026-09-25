// api/forge-clients.js
// Forge caller program: paying clients, lifecycle, and commission.
// Auth reuses the Room session cookie + Forge roles (same as
// api/forge-leads.js). Data lives in Supabase via lib/forgeDb.js.
//
// GET  /api/forge-clients                 -> worker: my clients + what I'm owed
// GET  /api/forge-clients?scope=all       -> manager: every client (+ ?status=)
// GET  /api/forge-clients?scope=followups -> manager: day-14 calls due now
// GET  /api/forge-clients?scope=callers   -> manager: callers + active clients, MRR, owed
// POST /api/forge-clients { action, ... }
//   convert     { leadId, tier }                 worker (their lead) / manager
//   upgrade     { clientId, tier }               owner/assignee / manager
//   cancel      { clientId }                     owner/assignee / manager
//   churn       { clientId }                     owner/assignee / manager
//   reactivate  { clientId, tier? }              owner/assignee / manager
//   assign      { clientId, username }           manager (follow-up only, no money moves)
//   transfer    { clientId, username, reason }   manager (moves recurring going forward)

import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeWorker, isForgeManager } from '../lib/forgeRoles.js';
import { getLead } from '../lib/forgeLeads.js';
import {
  ensureCaller, getCallerByUsername, getClient, upsertLeadFromRedis, convertLead,
  upgradeClient, requestCancel, churnClient, reactivateClient, assignFollowUp,
  transferOwnership, listClients, dueFollowUps, commissionOwed, callerSummaries,
} from '../lib/forgeDb.js';

const MANAGER_ONLY = new Set(['assign', 'transfer']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const username = await getRequestUser(req);
  if (!username) return res.status(401).json({ error: 'Sign in required.' });
  const [worker, manager] = await Promise.all([isForgeWorker(username), isForgeManager(username)]);
  if (!worker) return res.status(403).json({ error: 'Not a Forge account. Ask a manager to grant access.' });

  try {
    const me = await ensureCaller(username);

    if (req.method === 'GET') {
      const scope = req.query?.scope;
      if (scope === 'callers') {
        if (!manager) return res.status(403).json({ error: 'Manager access required.' });
        return res.status(200).json({ callers: await callerSummaries() });
      }
      if (scope === 'all' || scope === 'followups') {
        if (!manager) return res.status(403).json({ error: 'Manager access required.' });
        const clients = scope === 'followups' ? await dueFollowUps() : await listClients({ status: req.query?.status });
        return res.status(200).json({ clients });
      }
      const [owned, assigned, owedCents] = await Promise.all([
        listClients({ ownerId: me.id }), listClients({ assignedTo: me.id }), commissionOwed(me.id),
      ]);
      const clients = [...new Map([...owned, ...assigned].map((c) => [c.id, c])).values()];
      return res.status(200).json({ clients, owedCents });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { action, leadId, clientId, tier, username: targetUsername, reason } = req.body || {};
    if (MANAGER_ONLY.has(action) && !manager) return res.status(403).json({ error: 'Manager access required.' });

    if (action === 'convert') {
      const redisLead = await getLead(leadId);
      if (!redisLead) return res.status(404).json({ error: 'Lead not found.' });
      if (!manager && redisLead.assignedTo !== username) return res.status(403).json({ error: 'That lead is not assigned to you.' });
      const pgLead = await upsertLeadFromRedis(redisLead, me.id);
      const client = await convertLead({ leadId: pgLead.id, callerId: me.id, tier });
      return res.status(201).json({ client });
    }

    const client = await getClient(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found.' });
    const mine = client.commission_owner === me.id || client.assigned_to === me.id;
    if (!manager && !mine) return res.status(403).json({ error: 'Not your client.' });

    let result;
    switch (action) {
      case 'upgrade':    result = await upgradeClient({ clientId, toTier: tier, closedByCallerId: me.id }); break;
      case 'cancel':     result = await requestCancel({ clientId, changedBy: username }); break;
      case 'churn':      result = await churnClient({ clientId, changedBy: username }); break;
      case 'reactivate': result = await reactivateClient({ clientId, tier, changedBy: username }); break;
      case 'assign':
      case 'transfer': {
        const target = await getCallerByUsername(targetUsername) || (targetUsername ? await ensureCaller(targetUsername) : null);
        if (!target) return res.status(400).json({ error: 'username is required.' });
        result = action === 'assign'
          ? await assignFollowUp({ clientId, callerId: target.id })
          : await transferOwnership({ clientId, toCallerId: target.id, reason, transferredBy: username });
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    return res.status(200).json({ client: result });
  } catch (err) {
    console.error('forge-clients handler failed:', err.message);
    return res.status(400).json({ error: err.message || 'Request failed.' });
  }
}
