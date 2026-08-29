// /pages/api/chat.js
// Nex's brain — handles chat, short-term conversation flow, and
// structured long-term memory (Nex can save memories himself).

import fs from 'fs';
import path from 'path';
import { listMemories, addMemory } from '../lib/memory.js';

// ============================================================
// PROVIDER CONFIG
// ============================================================
const CLAUDE_MODEL = 'claude-sonnet-5'; // swap model name here anytime
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

// ============================================================
// SHORT-TERM ROLLING BUFFER — just enough for mid-conversation
// continuity ("what did you just say"). Long-term facts live in
// structured memory (lib/memory.js) instead of growing forever here.
// ============================================================
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const RECENT_KEY = 'nex:recent-conversation';
const RECENT_LIMIT = 12; // ~6 exchanges

async function loadRecent() {
  if (!KV_URL || !KV_TOKEN) {
    console.error('loadRecent: missing KV_URL or KV_TOKEN env vars');
    return [];
  }
  try {
    const res = await fetch(`${KV_URL}/get/${RECENT_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || contentType.includes('text/html')) return [];
    const data = await res.json();
    if (!data.result) return [];
    try {
      const parsed = JSON.parse(data.result);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } catch (err) {
    console.error('loadRecent: fetch threw', err.message);
    return [];
  }
}

async function saveRecent(fullHistory) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    const cleanHistory = fullHistory.filter((msg) => msg.role !== 'system' && msg.content);
    const trimmed = cleanHistory.slice(-RECENT_LIMIT);
    const res = await fetch(`${KV_URL}/set/${RECENT_KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(trimmed),
    });
    if (!res.ok) {
      const bodyText = await res.text();
      console.error('saveRecent: bad response', res.status, bodyText.slice(0, 300));
    }
  } catch (err) {
    console.error('saveRecent: fetch threw', err.message);
  }
}

// ============================================================
// TOOLS — Nex can call these himself mid-conversation.
// ============================================================
const TOOLS = [
  {
    name: 'save_memory',
    description:
      "Save a durable fact worth remembering long-term — about Mr. Lopez, a client project, or a standing preference/instruction. Only call this for things genuinely worth recalling in future sessions, not casual chit-chat or one-off small talk.",
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact to remember, written clearly and standalone (should make sense read alone, out of context).',
        },
        category: {
          type: 'string',
          enum: ['fact', 'project'],
          description: '"fact" for general info/preferences about Mr. Lopez or how Nex should operate. "project" for notes tied to a specific client project.',
        },
      },
      required: ['content'],
    },
  },
];

// ============================================================
// CLAUDE CALL — handles one round of tool use (save_memory) if
// Claude decides to call it, then returns the final text reply.
// ============================================================
async function callClaude(history, identityText, memoriesText) {
  const systemPrompt = `${identityText}\n\n## What I remember long-term:\n${memoriesText || '(nothing saved yet)'}`;

  const claudeMessages = history.map((msg) => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content || '',
  }));

  async function send(messages) {
    const response = await fetch(CLAUDE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || contentType.includes('text/html')) {
      const errorText = await response.text();
      console.error('Claude rejected the request:', errorText);
      throw new Error('Claude API returned an error response.');
    }
    return response.json();
  }

  let messages = claudeMessages;
  let data = await send(messages);

  // If Claude decided to save a memory, run it, then let Claude finish its reply.
  if (data.stop_reason === 'tool_use') {
    const toolUseBlocks = data.content.filter((block) => block.type === 'tool_use');
    const toolResults = [];

    for (const block of toolUseBlocks) {
      if (block.name === 'save_memory') {
        try {
          const memory = await addMemory(block.input.content, block.input.category);
          console.log('save_memory tool: saved', memory.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Saved to memory: "${memory.content}"`,
          });
        } catch (err) {
          console.error('save_memory tool failed:', err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Failed to save that memory.',
            is_error: true,
          });
        }
      }
    }

    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      { role: 'user', content: toolResults },
    ];
    data = await send(messages);
  }

  const textBlock = data?.content?.find((block) => block.type === 'text');
  const reply = textBlock?.text;
  if (!reply) {
    console.error('Unexpected Claude response shape:', data);
    throw new Error('Malformed response from Claude.');
  }

  return reply;
}

// ============================================================
// HANDLER
// ============================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  if (!CLAUDE_API_KEY) {
    return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY environment variable.' });
  }

  // Load identity doc
  const identityPath = path.join(process.cwd(), 'IDENTITY.md');
  let NEX_IDENTITY = 'You are Nex, an AI agent inside Nexus Hub.';
  try {
    if (fs.existsSync(identityPath)) {
      NEX_IDENTITY = fs.readFileSync(identityPath, 'utf-8');
    }
  } catch (fileErr) {
    // fall back to the default string above
  }

  try {
    const [recent, memories] = await Promise.all([loadRecent(), listMemories()]);
    const runningHistory = recent.filter((msg) => msg.role !== 'system');
    const updatedHistoryWithUser = [...runningHistory, { role: 'user', content: message }];

    const memoriesText = memories.map((m) => `- [${m.category}] ${m.content}`).join('\n');

    const reply = await callClaude(updatedHistoryWithUser, NEX_IDENTITY, memoriesText);

    const finalHistory = [...updatedHistoryWithUser, { role: 'assistant', content: reply }];
    await saveRecent(finalHistory);

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Nex chat handler crashed:', err);
    return res.status(500).json({ error: 'Internal system error processing your message.' });
  }
}
