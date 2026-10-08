import {preserveChatMemories} from './chatMemoryRetention.js';
import {purgeChatMemoryCandidates} from './memory.js';
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
export const RECENT_LIMIT = 24;
export const THREAD_LIMIT = 20;
export const THREAD_MESSAGE_LIMIT = 40;

export function primaryOperatorUsername() {
  return String(process.env.NEXUS_OPERATOR_USERNAMES || 'Mrlopez')
    .split(',')[0]
    .trim() || 'Mrlopez';
}

export function recentKeyFor(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/u.test(normalized)) throw new Error('A valid operator username is required for Nex conversation storage.');
  return `nex:recent-conversation:${normalized}`;
}

export function threadsKeyFor(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/u.test(normalized)) throw new Error('A valid operator username is required for Nex conversation storage.');
  return `nex:conversation-threads:${normalized}:v1`;
}

export function normalizeThreadId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(id)) throw new Error('A valid Nex conversation thread id is required.');
  return id;
}

export function isProtectedConversationThreadId(value) {
  const id = normalizeThreadId(value);
  return id === 'nex-main' || id.startsWith('agent-') || id.startsWith('group-');
}

function cleanMessages(messages, limit = THREAD_MESSAGE_LIMIT) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role !== 'system' && typeof message?.content === 'string' && message.content.trim())
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
      ...(typeof message.model === 'string' ? { model: message.model } : {}),
      ...(message.usage && typeof message.usage === 'object' ? { usage: message.usage } : {}),
    }))
    .slice(-limit);
}

function parseThread(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const id = normalizeThreadId(parsed?.id);
    const messages = cleanMessages(parsed?.messages);
    return {
      id,
      title: String(parsed?.title || messages[0]?.content || 'New chat').replace(/\s+/gu, ' ').trim().slice(0, 80) || 'New chat',
      updated_at: Number.isFinite(parsed?.updated_at) ? parsed.updated_at : 0,
      messages,
    };
  } catch {
    return null;
  }
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) return null;
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Nex conversation Redis ${command[0]} failed`);
  return data.result;
}

export async function loadRecentConversation(username) {
  const key = recentKeyFor(username); // Invalid identities still fail closed.
  let raw;
  try {
    raw = await redisCommand(['GET', key]);
  } catch (error) {
    console.error('Nex conversation load failed open:', error.message);
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((message) => message && typeof message.content === 'string' && message.content.trim())
      : [];
  } catch {
    return [];
  }
}

export async function saveRecentConversation(username, fullHistory) {
  const key = recentKeyFor(username); // Validate before the best-effort write.
  if (!KV_URL || !KV_TOKEN) return;
  const clean = (Array.isArray(fullHistory) ? fullHistory : [])
    .filter((message) => message?.role !== 'system' && typeof message?.content === 'string' && message.content.trim())
    .slice(-RECENT_LIMIT);
  try {
    await redisCommand(['SET', key, JSON.stringify(clean)]);
  } catch (error) {
    console.error('Nex conversation save failed open:', error.message);
  }
}

export async function listConversationThreads(username) {
  const key = threadsKeyFor(username);
  let result;
  try {
    result = await redisCommand(['HGETALL', key]);
  } catch (error) {
    console.error('Nex conversation thread list failed open:', error.message);
    return [];
  }
  if (!Array.isArray(result)) return [];
  const threads = [];
  for (let index = 1; index < result.length; index += 2) {
    const thread = parseThread(result[index]);
    if (thread) threads.push(thread);
  }
  return threads
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, THREAD_LIMIT)
    .map(({ messages, ...summary }) => ({ ...summary, message_count: messages.length }));
}

export async function loadConversationThread(username, threadId) {
  const key = threadsKeyFor(username);
  const id = normalizeThreadId(threadId);
  let raw;
  try {
    raw = await redisCommand(['HGET', key, id]);
  } catch (error) {
    console.error('Nex conversation thread load failed open:', error.message);
    return null;
  }
  return parseThread(raw);
}

export async function saveConversationThread(username, { id: threadId, title, messages, updated_at: updatedAt } = {}) {
  const key = threadsKeyFor(username);
  const id = normalizeThreadId(threadId);
  const clean = cleanMessages(messages);
  const record = {
    id,
    title: String(title || clean[0]?.content || 'New chat').replace(/\s+/gu, ' ').trim().slice(0, 80) || 'New chat',
    updated_at: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    messages: clean,
  };
  if (!KV_URL || !KV_TOKEN) return record;
  try {
    await redisCommand(['HSET', key, id, JSON.stringify(record)]);
    const result = await redisCommand(['HGETALL', key]);
    if (Array.isArray(result)) {
      const stored = [];
      for (let index = 0; index < result.length; index += 2) {
        const parsed = parseThread(result[index + 1]);
        if (parsed) stored.push(parsed);
      }
      const stale = stored.sort((a, b) => b.updated_at - a.updated_at).slice(THREAD_LIMIT);
      if (stale.length) await redisCommand(['HDEL', key, ...stale.map((thread) => thread.id)]);
    }
  } catch (error) {
    console.error('Nex conversation thread save failed open:', error.message);
  }
  return record;
}

export async function deleteConversationThread(username, threadId) {
  const key = threadsKeyFor(username);
  const id = normalizeThreadId(threadId);
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    return Number(await redisCommand(['HDEL', key, id])) > 0;
  } catch (error) {
    console.error('Nex conversation thread delete failed open:', error.message);
    return false;
  }
}

export async function clearConversationThreads(username, keepThreadIds = [], {preserve=preserveChatMemories,purge=purgeChatMemoryCandidates} = {}) {
  const key = threadsKeyFor(username);
  const keep = new Set((Array.isArray(keepThreadIds) ? keepThreadIds : []).map((value) => {
    try { return normalizeThreadId(value); } catch { return null; }
  }).filter(Boolean));
  if (!KV_URL || !KV_TOKEN) return { deleted:0, threadIds:[] };
  try {
    const result = await redisCommand(['HGETALL', key]);
    if (!Array.isArray(result)) return { deleted:0, threadIds:[] };
    const threadIds = [];
    for (let index = 0; index < result.length; index += 2) {
      let id;
      try { id = normalizeThreadId(result[index]); } catch { continue; }
      if (!isProtectedConversationThreadId(id) && !keep.has(id)) threadIds.push(id);
    }
    if (!threadIds.length) return { deleted:0, threadIds:[] };
    const selected=[];
    for(let index=0;index<result.length;index+=2)if(threadIds.includes(result[index])){const record=parseThread(result[index+1]);if(record)selected.push(record);}
    const memory=await preserve(selected);
    await purge(selected);
    const expected=[];for(let index=0;index<result.length;index+=2)if(threadIds.includes(result[index]))expected.push(result[index],result[index+1]);
    const script="for i=1,#ARGV,2 do if redis.call('HGET',KEYS[1],ARGV[i]) ~= ARGV[i+1] then return -1 end end local count=0; for i=1,#ARGV,2 do count=count+redis.call('HDEL',KEYS[1],ARGV[i]) end return count";
    const deleted=Number(await redisCommand(['EVAL',script,1,key,...expected]));
    if(deleted<0)throw new Error('A chat changed during cleanup. Try again after its work finishes.');
    return { deleted, threadIds, memoriesSaved:memory.saved };
  } catch (error) {
    console.error('Nex conversation thread clear failed open:', error.message);
    throw error;
  }
}

export async function appendRecentConversation(username, message) {
  const history = await loadRecentConversation(username);
  history.push(message);
  await saveRecentConversation(username, history);
  return history.slice(-RECENT_LIMIT);
}

export async function clearConversationMessages(username,threadId,{preserve=preserveChatMemories,purge=purgeChatMemoryCandidates}={}){
  const key=threadsKeyFor(username),id=normalizeThreadId(threadId);
  const raw=await redisCommand(['HGET',key,id]);
  const thread=parseThread(raw);if(!thread)return {cleared:false,memoriesSaved:0};
  const memory=await preserve([thread]);
  await purge([thread]);
  const cleared={...thread,title:'New chat',messages:[],updated_at:Date.now()};
  const script="if redis.call('HGET',KEYS[1],ARGV[1]) ~= ARGV[2] then return 0 end redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]); return 1";
  const changed=await redisCommand(['EVAL',script,1,key,id,raw,JSON.stringify(cleared)]);
  if(!Number(changed))throw new Error('This conversation changed while checking memories. Try again when it finishes.');
  return {cleared:true,memoriesSaved:memory.saved};
}
