// /api/chat-recent.js
// Cheap, read-only poll target for the chat panel — same shape as the
// existing /api/board poll that already runs every ~4s. No model call,
// no tokens spent: this is a single KV GET, nothing more. Lets the
// frontend show checkpoint lines (from lib/agentNotify.js) as they land
// in nex:recent-conversation without waiting for Justin to send a new
// message.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const RECENT_KEY = 'nex:recent-conversation';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }
  if (!KV_URL || !KV_TOKEN) return res.status(200).json({ messages: [] });

  try {
    const kvRes = await fetch(`${KV_URL}/get/${RECENT_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await kvRes.json();
    let messages = [];
    if (data?.result) {
      try {
        const parsed = JSON.parse(data.result);
        if (Array.isArray(parsed)) messages = parsed;
      } catch {
        messages = [];
      }
    }
    // No-cache: the whole point is freshness on a cheap poll.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ messages });
  } catch (err) {
    console.error('chat-recent: fetch failed', err.message);
    return res.status(200).json({ messages: [] });
  }
}
