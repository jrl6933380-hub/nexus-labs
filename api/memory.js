// /api/memory.js
// CRUD endpoint for Nex's structured long-term memory. Used by the
// memory dashboard UI (public/memory.html) and callable directly.

import { listMemories, addMemory, updateMemory, deleteMemory, listMemoryCandidates, curatePendingMemories, promoteMemoryCandidate, rejectMemoryCandidate } from '../lib/memory.js';
import { initSentry, Sentry } from '../lib/sentry.js';
import { getNexusOwner } from '../lib/nexusOwnerAuth.js';
import crypto from 'node:crypto';

function internalAgentAuthorized(req) {
  const expected = process.env.NEXUS_AGENT_API_TOKEN;
  const header = String(req.headers?.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!expected || !supplied) return false;
  const left = crypto.createHash('sha256').update(supplied).digest();
  const right = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  initSentry();

  const owner = await getNexusOwner(req).catch(() => null);
  if (!owner && !internalAgentAuthorized(req)) {
    return res.status(401).json({ error: 'Nexus owner or internal agent authentication required.' });
  }

  try {
    if (req.method === 'GET') {
      const [memories, candidates] = await Promise.all([listMemories(), listMemoryCandidates({ status: null })]);
      return res.status(200).json({ memories, candidates });
    }

    if (req.method === 'POST') {
      const { action, id, content, category, scope, tags } = req.body || {};
      if (action === 'curate') return res.status(200).json({ result: await curatePendingMemories({ force: true }) });
      if (action === 'promote') {
        if (!id) return res.status(400).json({ error: 'Missing candidate id' });
        return res.status(200).json({ memory: await promoteMemoryCandidate(id, { content, category, scope, tags }) });
      }
      if (action === 'reject') {
        if (!id) return res.status(400).json({ error: 'Missing candidate id' });
        return res.status(200).json({ candidate: await rejectMemoryCandidate(id) });
      }
      if (!content) return res.status(400).json({ error: 'Missing content' });
      const memory = await addMemory(content, category, tags, { scope, provenance: 'stated' });
      return res.status(200).json({ memory });
    }

    if (req.method === 'PATCH') {
      const { id } = req.query;
      const { content, category } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const memory = await updateMemory(id, content, category);
      return res.status(200).json({ memory });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await deleteMemory(id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('memory handler crashed:', err.message);
    Sentry.captureException(err);
    await Sentry.flush(2000);
    return res.status(500).json({ error: 'Internal error handling memory request.' });
  }
}
