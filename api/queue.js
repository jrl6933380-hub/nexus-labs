// /api/queue.js
// Approval queue endpoint — the dashboard reads pending items here,
// and Approve/Reject buttons post back to this same endpoint. Shares
// its approve/reject logic with the SMS webhook (api/sms-webhook.js)
// via lib/queue.js, so both paths behave identically.

import { listQueue, approveQueueItem, rejectQueueItem, notifyQueue } from '../lib/queue.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const items = await listQueue();
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      const { id, action } = req.body || {};
      if (!id || !action) return res.status(400).json({ error: 'Missing id or action' });

      if (action === 'reject') {
        try {
          const { item } = await rejectQueueItem(id);
          await notifyQueue();
          return res.status(200).json({ rejected: true, id, item });
        } catch (err) {
          return res.status(404).json({ error: err.message });
        }
      }

      if (action === 'approve') {
        try {
          const { item, result } = await approveQueueItem(id);
          await notifyQueue();
          return res.status(200).json({ approved: true, id, item, result });
        } catch (err) {
          console.error('queue approve execution failed:', err.message);
          // leave it in the queue so Mr. Lopez can see it failed and retry/reject
          return res.status(500).json({ error: `Action failed when executed: ${err.message}` });
        }
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('queue handler crashed:', err.message);
    return res.status(500).json({ error: 'Internal error handling queue request.' });
  }
}
