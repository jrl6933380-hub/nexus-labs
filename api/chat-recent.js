// /api/chat-recent.js
// Cheap, read-only poll target for the chat panel — same shape as the
// existing /api/board poll that already runs every ~4s. No model call,
// no tokens spent: this is a single KV GET, nothing more. Lets the
// frontend show checkpoint lines (from lib/agentNotify.js) as they land
// in nex:recent-conversation without waiting for Justin to send a new
// message.

import { loadRecentConversation } from '../lib/nexConversationStore.js';
import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }
  const operatorUser = await getRequestUser(req).catch(() => null);
  if (!operatorUser || !isOperatorUser(operatorUser)) {
    return res.status(401).json({ error: 'Operator authentication required.' });
  }

  try {
    const messages = await loadRecentConversation(operatorUser);
    // No-cache: the whole point is freshness on a cheap poll.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ messages });
  } catch (err) {
    console.error('chat-recent: fetch failed', err.message);
    return res.status(200).json({ messages: [] });
  }
}
