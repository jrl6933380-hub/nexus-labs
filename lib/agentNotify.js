// lib/agentNotify.js
// Lightweight checkpoint notifications for agent task progress —
// the "heads up before/while working, not just a wall of silence
// until done" behavior Justin asked for.
//
// Deliberately best-effort: a notification failure must NEVER break
// or delay the underlying board/task action that triggered it. Every
// call is wrapped so it can't throw upward into board.js.

import { sendEmail } from './emailSender.js';

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
