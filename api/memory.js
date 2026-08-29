// /api/memory.js
// CRUD endpoint for Nex's structured long-term memory. Used by the
// memory dashboard UI (public/memory.html) and callable directly.

import { listMemories, addMemory, deleteMemory } from '../lib/memory.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const memories = await listMemories();
      return res.status(200).json({ memories });
    }

    if (req.method === 'POST') {
      const { content, category } = req.body || {};
      if (!content) return res.status(400).json({ error: 'Missing content' });
      const memory = await addMemory(content, category);
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
    return res.status(500).json({ error: 'Internal error handling memory request.' });
  }
}
