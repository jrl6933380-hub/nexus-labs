// /pages/api/chat.js
// Nex's brain — handles chat, memory (Upstash), and talks to the AI provider.

import fs from 'fs';
import path from 'path';

// ============================================================
// PROVIDER CONFIG — this is the only section you touch to swap
// AI providers or models later (e.g. Gemini -> OpenAI -> Claude).
// ============================================================
const PROVIDER = 'gemini'; // change to 'openai' later if you build that branch back in
const GEMINI_MODEL = 'gemini-2.5-flash';// swap model name here anytime
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ============================================================
// MEMORY (Upstash Redis via REST API)
// ============================================================
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const HISTORY_KEY = 'nex:conversation-log';

async function loadHistory() {
  if (!KV_URL || !KV_TOKEN) return [];
  try {
    const res = await fetch(`${KV_URL}/get/${HISTORY_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || contentType.includes('text/html')) return [];
    const data = await res.json();
    if (!data.result) return [];
    try {
      return JSON.parse(data.result);
    } catch {
      return [];
    }
  } catch (err) {
    return [];
  }
}

async function saveHistory(fullHistory) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    const cleanHistory = fullHistory.filter((msg) => msg.role !== 'system' && msg.content);
    const trimmed = cleanHistory.slice(-40);
    await fetch(`${KV_URL}/set/${HISTORY_KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: JSON.stringify(trimmed) }),
    });
  } catch (err) {
    // swallow — memory is best-effort, shouldn't crash the chat
  }
}

// ============================================================
// PROVIDER CALL — isolated so swapping providers later only
// means writing a new function like this one, not touching
// the history/memory logic above.
// ============================================================
async function callGemini(history, identityText) {
  const geminiContents = history.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content || '' }],
  }));

  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: geminiContents,
      systemInstruction: {
        parts: [{ text: identityText }],
      },
      generationConfig: {
        maxOutputTokens: 800,
      },
    }),
  });

  const responseContentType = response.headers.get('content-type') || '';
  if (!response.ok || responseContentType.includes('text/html')) {
    const errorText = await response.text();
    console.error('Gemini rejected the request:', errorText);
    throw new Error('Gemini API returned an error response.');
  }

  const data = await response.json();

  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) {
    console.error('Unexpected Gemini response shape:', data);
    throw new Error('Malformed response from Gemini.');
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
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable.' });

  // Load identity doc — filename must match what's actually in the repo: IDENTITY.md
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
    const history = await loadHistory();
    const runningHistory = history.filter((msg) => msg.role !== 'system');
    const updatedHistoryWithUser = [...runningHistory, { role: 'user', content: message }];

    let reply;
    if (PROVIDER === 'gemini') {
      reply = await callGemini(updatedHistoryWithUser, NEX_IDENTITY);
    } else {
      return res.status(500).json({ error: `Unknown provider configured: ${PROVIDER}` });
    }

    const finalHistory = [...updatedHistoryWithUser, { role: 'assistant', content: reply }];
    await saveHistory(finalHistory);

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Nex chat handler crashed:', err);
    return res.status(500).json({ error: 'Internal system error processing your message.' });
  }
}
