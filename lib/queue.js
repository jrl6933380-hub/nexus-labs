// /lib/queue.js
// Approval queue — file-writing actions Nex proposes get parked here
// instead of executing immediately. Mr. Lopez approves or rejects
// each one from the dashboard, or by text (see notifyQueue below).
//
// Storage: Upstash Redis hash "nex:queue" — field = item id, value =
// JSON string. Same pattern as lib/memory.js. A second key tracks
// which item was last texted, so notifyQueue doesn't re-text the
// same item on every unrelated queue read.

import { createOrUpdateFile, deleteFile, createRepo, deleteRepo, commitFiles } from './github.js';
import { sendSms } from './sms.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const QUEUE_KEY = 'nex:queue';
const SMS_CURRENT_KEY = 'nex:queue:sms_current';

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('queue redisCommand failed', command[0], res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

export async function listQueue() {
  try {
    const raw = await redisCommand(['HGETALL', QUEUE_KEY]);
    if (!raw || !Array.isArray(raw)) return [];
    const items = [];
    for (let i = 0; i < raw.length; i += 2) {
      try {
        items.push(JSON.parse(raw[i + 1]));
      } catch {
        // skip a malformed entry
      }
    }
    items.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    return items;
  } catch (err) {
    console.error('listQueue failed:', err.message);
    return [];
  }
}

export async function addToQueue({ tool, input, description }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item = {
    id,
    tool,
    input,
    description: description || `${tool} on ${input?.path || 'unknown file'}`,
    created_at: Date.now(),
  };
  await redisCommand(['HSET', QUEUE_KEY, id, JSON.stringify(item)]);

  // Text Mr. Lopez if nothing is currently waiting on a reply. Never
  // let an SMS hiccup break the actual queue add.
  try {
    await notifyQueue();
  } catch (err) {
    console.error('addToQueue: notifyQueue failed:', err.message);
  }

  return item;
}

export async function getQueueItem(id) {
  const raw = await redisCommand(['HGET', QUEUE_KEY, id]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function removeFromQueue(id) {
  await redisCommand(['HDEL', QUEUE_KEY, id]);
}

function executeQueuedItem(item) {
  if (item.tool === 'create_repo_file' || item.tool === 'update_repo_file') {
    return createOrUpdateFile(item.input);
  }
  if (item.tool === 'delete_repo_file') {
    return deleteFile(item.input);
  }
  if (item.tool === 'create_repo') {
    return createRepo(item.input);
  }
  if (item.tool === 'delete_repo') {
    return deleteRepo(item.input);
  }
  if (item.tool === 'commit_repo_files') {
    return commitFiles(item.input);
  }
  throw new Error(`Unknown queued tool: ${item.tool}`);
}

// Shared by the dashboard (api/queue.js) and the SMS webhook
// (api/sms-webhook.js) so both approve the exact same way.
export async function approveQueueItem(id) {
  const item = await getQueueItem(id);
  if (!item) throw new Error('Queue item not found (may already be handled)');
  const result = await executeQueuedItem(item);
  await removeFromQueue(id);
  return { item, result };
}

export async function rejectQueueItem(id) {
  const item = await getQueueItem(id);
  if (!item) throw new Error('Queue item not found (may already be handled)');
  await removeFromQueue(id);
  return { item };
}

// Approves everything currently waiting, in the order it was queued.
// Stops at the first failure so a bad item doesn't blast through the
// rest unsupervised — whatever's left stays in the queue.
export async function approveAllQueueItems() {
  const items = await listQueue();
  const results = [];
  for (const item of items) {
    try {
      const result = await executeQueuedItem(item);
      await removeFromQueue(item.id);
      results.push({ id: item.id, description: item.description, ok: true, result });
    } catch (err) {
      console.error('approveAllQueueItems: stopped on', item.id, err.message);
      results.push({ id: item.id, description: item.description, ok: false, error: err.message });
      break;
    }
  }
  return results;
}

// Short, easy-to-text-back reference for a queue item — last 4 chars
// of its random suffix, uppercased (e.g. "1788251448689-a2f19k" -> "A2F1").
function shortCode(id) {
  const suffix = id.split('-')[1] || id;
  return suffix.slice(0, 4).toUpperCase();
}

async function getCurrentNotifiedId() {
  return redisCommand(['GET', SMS_CURRENT_KEY]);
}

async function setCurrentNotifiedId(id) {
  if (id) {
    await redisCommand(['SET', SMS_CURRENT_KEY, id]);
  } else {
    await redisCommand(['DEL', SMS_CURRENT_KEY]);
  }
}

// Texts the oldest pending item, one at a time, in queue order.
// Safe to call after every queue mutation — it only actually sends
// when the front of the queue has changed since the last text, so
// it never double-texts the same item or spams on unrelated reads.
export async function notifyQueue() {
  const items = await listQueue();

  if (items.length === 0) {
    await setCurrentNotifiedId(null);
    return;
  }

  const next = items[0];
  const currentId = await getCurrentNotifiedId();
  if (currentId === next.id) return; // already texted this one, waiting on a reply

  const code = shortCode(next.id);
  const remaining = items.length - 1;
  const body = `Nexus (${code}): ${next.description}` +
    (remaining > 0 ? `\n${remaining} more waiting after this.` : '') +
    `\nReply "ship it" to approve, "skip" to reject${items.length > 1 ? `, or "ship in order" to approve all ${items.length}` : ''}.`;

  await sendSms(body);
  await setCurrentNotifiedId(next.id);
}
