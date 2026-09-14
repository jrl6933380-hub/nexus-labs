// lib/agentNotify.js
// Lightweight checkpoint notifications for agent task progress —
// the "heads up before/while working, not just a wall of silence
// until done" behavior Justin asked for.
//
// Deliberately best-effort: a notification failure must NEVER break
// or delay the underlying board/task action that triggered it. Every
// call is wrapped so it can't throw upward into board.js.

import { sendEmail } from './emailSender.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const RECENT_KEY = 'nex:recent-conversation';
const RECENT_LIMIT = 24; // must match api/chat.js's own limit

async function redisCommand(command) {
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('KV command failed');
  return data.result;
}

// Drops a checkpoint line straight into the SAME rolling chat history
// api/chat.js reads from — this is the primary channel: Justin mostly
// talks to Nex in chat, so the checkpoint should show up there, not
// in a separate inbox. It reads next time the chat loads/refreshes;
// it is not a live push while a tab sits open (see PR notes).
export async function postChatCheckpoint({ title, status, note, owner }) {
  if (!KV_URL || !KV_TOKEN) return { posted: false, reason: 'KV not configured' };
  try {
    const raw = await redisCommand(['GET', RECENT_KEY]);
    let history = [];
    if (raw) {
      try { history = JSON.parse(raw); } catch { history = []; }
      if (!Array.isArray(history)) history = [];
    }
    const line = `\uD83D\uDD14 ${owner || 'agent'} \u2014 "${title || 'task'}" \u2192 ${status}${note ? `: ${note}` : ''}`;
    history.push({ role: 'assistant', content: line });
    await redisCommand(['SET', RECENT_KEY, JSON.stringify(history.slice(-RECENT_LIMIT))]);
    return { posted: true };
  } catch (err) {
    console.error('postChatCheckpoint: failed (non-fatal)', err.message);
    return { posted: false, reason: err.message };
  }
}

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || null;

// Only notify on milestones worth a human's attention, not every
// intermediate note — otherwise a long task turns into an inbox
// flood instead of a useful checkpoint trail.
const NOTIFY_STATUSES = new Set(['planning', 'blocked', 'waiting_for_justin', 'complete']);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Fires a short email when a task crosses into one of the milestone
// statuses above. Silently no-ops if NOTIFY_EMAIL isn't configured
// yet, and swallows send failures — this is a nice-to-have signal,
// never a dependency the core board flow can be broken by.
export async function notifyCheckpoint({ taskId, title, status, note, owner }) {
  if (!NOTIFY_EMAIL) return { sent: false, reason: 'NOTIFY_EMAIL not configured' };
  if (!status || !NOTIFY_STATUSES.has(status)) return { sent: false, reason: 'status not in notify set' };

  const subject = `[${owner || 'agent'}] ${title || taskId} \u2192 ${status}`;
  const html = `
    <p><strong>${escapeHtml(owner || 'An agent')}</strong> just moved a task to <strong>${escapeHtml(status)}</strong>.</p>
    <p><strong>Task:</strong> ${escapeHtml(title || taskId)}</p>
    ${note ? `<p><strong>Note:</strong> ${escapeHtml(note)}</p>` : ''}
  `;

  try {
    await sendEmail({ to: NOTIFY_EMAIL, subject, html });
    return { sent: true };
  } catch (err) {
    console.error('notifyCheckpoint: send failed (non-fatal)', err.message);
    return { sent: false, reason: err.message };
  }
}
