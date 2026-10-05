// Read-only transcript access for the signed-in customer's active project.
// Writes happen inside room-assistant so a caller cannot forge assistant turns.

import { getRequestUser } from '../lib/roomAuth.js';
import { roomConversations } from '../lib/roomConversation.js';

export function createConversationHandler({ resolveUser = getRequestUser, conversations = roomConversations } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
    try {
      const username = await resolveUser(req);
      if (!username) return res.status(401).json({ error: 'Sign in required' });
      const projectId = req.query?.projectId;
      if (typeof projectId !== 'string') return res.status(400).json({ error: 'Project id required' });
      const turns = await conversations.getConversation(username, projectId);
      return res.status(200).json({ turns });
    } catch (error) {
      if (error.message === 'Invalid Room project id') return res.status(400).json({ error: error.message });
      console.error('room-conversation handler crashed:', error.message);
      return res.status(500).json({ error: 'Failed to load project conversation' });
    }
  };
}

export default createConversationHandler();
