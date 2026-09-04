// /pages/api/chat.js
// Nex's visible chat endpoint — thin wrapper around the shared brain
// in lib/nexBrain.js. Handles the KV-backed rolling history so the
// dashboard shows real conversation continuity; the actual thinking
// (tools, identity, memory) all lives in nexBrain now.

import { initSentry, Sentry } from '../lib/sentry.js';
import { askNex, MODEL_TIERS } from '../lib/nexBrain.js';
import {
  isDisengageCommand,
  isEngageCommand,
  startClaudeHandoff,
} from '../lib/claudeHandoff.js';
import { getNexChatMode, disengageNex, engageNex } from '../lib/nexMode.js';
import { detectHyperfocusTrigger, buildHyperfocusDirective } from '../lib/hyperfocusTriggers.js';

// ============================================================
// SHORT-TERM ROLLING BUFFER — just enough for mid-conversation
// continuity ("what did you just say"). Long-term facts live in
// structured memory (lib/memory.js) instead of growing forever here.
// Every message resends this whole window to Claude's API, so it's a
// direct token/cost tradeoff, not a free knob — bumped from 12 to 24
// (6 to 12 exchanges) since Nex sessions run long when actually
// building something. Tune further either direction if it feels off.
// ============================================================
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const RECENT_KEY = 'nex:recent-conversation';
const RECENT_LIMIT = 24; // ~12 exchanges

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
      if (!Array.isArray(parsed)) return [];
      // Defensive: drop any entry with empty/missing content. A single
      // poisoned entry here would otherwise get resent to Claude on
      // every future request and crash every one of them — Claude's
      // API rejects empty message content, so no request could ever
      // succeed until the bad entry aged out or was purged. Filtering
      // on load means a bad entry can never get "stuck".
      return parsed.filter(
        (msg) => msg && typeof msg.content === 'string' && msg.content.trim().length > 0
      );
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
// HANDLER
// ============================================================
export default async function handler(req, res) {
  initSentry();

  // GET — used by the frontend on page load to re-render whatever
  // conversation is already saved, instead of always showing the
  // same hardcoded starter message.
  if (req.method === 'GET') {
    try {
      const recent = await loadRecent();
      return res.status(200).json({ messages: recent });
    } catch (err) {
      console.error('GET /api/chat failed to load history:', err.message);
      return res.status(200).json({ messages: [] });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message, model } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });

  // model is an optional tier override from the model picker: 'cheap',
  // 'standard', or 'heavy'. Anything else (including 'auto', missing,
  // or a typo) falls through to normal auto-routing in askNex.
  const forcedTier = MODEL_TIERS[model] ? model : null;

  try {
    // Deliberate test hook — send this exact phrase to force a real error,
    // useful for confirming Sentry (or any error monitoring) is actually working.
    if (message.trim() === 'TEST_SENTRY_ERROR') {
      throw new Error('This is a deliberate test error, triggered on purpose to confirm Sentry is catching things.');
    }

    const recent = await loadRecent();
    const runningHistory = recent.filter((msg) => msg.role !== 'system');

    // Exact command-level handoff: Nex does not imitate Claude. He creates
    // a constrained Board task and wakes a real Claude Routine session,
    // which reads the Board + BRIDGE.md before taking over.
    if (isDisengageCommand(message)) {
      const { task, wake } = await startClaudeHandoff();
      await disengageNex({ session_url: wake.session_url, task_id: task.id });
      const reply =
        `Nex disengaged. I’m paused while you work directly with Claude. ` +
        `Open the direct Claude session: ${wake.session_url}`;
      const usage = { input_tokens: 0, output_tokens: 0 };
      await saveRecent([
        ...runningHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: reply, model: 'claude-routine', usage },
      ]);
      return res.status(200).json({
        reply,
        model: 'claude-routine',
        usage,
        handoff: {
          task_id: task.id,
          session_id: wake.session_id,
          session_url: wake.session_url,
          replayed: wake.replayed,
        },
      });
    }

    // Returning to the Nex chat does not terminate the separate Claude
    // session, but it makes the ownership change explicit.
    if (isEngageCommand(message)) {
      await engageNex();
      const reply = 'Nex engaged. I’m back in the lead.';
      const usage = { input_tokens: 0, output_tokens: 0 };
      await saveRecent([
        ...runningHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: reply, model: 'nex', usage },
      ]);
      return res.status(200).json({ reply, model: 'nex', usage });
    }

    // Disengage is an ownership switch, not just a wake shortcut. The
    // separate Claude session retains its normal authorized connector
    // access; Nex does not continue consuming model calls or dispatching
    // work until Justin explicitly re-engages him.
    const chatMode = await getNexChatMode();
    if (chatMode.mode === 'disengaged') {
      return res.status(423).json({
        error: 'Nex is disengaged while you work directly with Claude.',
        mode: chatMode,
        instruction: 'Send “Nex engage” here when you want Nex back in the lead.',
      });
    }

    // Hyperfocus trigger phrases ("bring Claude in on this for
    // hyperfocus", "show active hyperfocus", "hyperfocus complete") are
    // recognized deterministically (regex, not model judgment) so they
    // always fire regardless of which tier answers this turn. The
    // detection only decides WHETHER to append an internal directive to
    // what's sent to the model — the actual extraction/tool-calling
    // (open_hyperfocus, publish_chat_context, wake_claude_code, etc.,
    // wired in nexBrain.js) still runs through a normal Nex turn, since
    // real context synthesis is exactly what an LLM does well and a
    // regex can't. The directive is never shown to Mr. Lopez or saved
    // to the visible transcript — only the message he actually typed is.
    const hyperfocusTrigger = detectHyperfocusTrigger(message);
    const messageForModel = hyperfocusTrigger
      ? `${message}\n\n${buildHyperfocusDirective(hyperfocusTrigger)}`
      : message;

    const {
      reply,
      updatedHistory,
      model: answeredModel,
      provider,
      usage,
      degraded,
    } = await askNex(messageForModel, runningHistory, forcedTier);

    // If the message sent to the model was augmented with an internal
    // hyperfocus directive, restore Mr. Lopez's original text in the
    // saved/returned history so the transcript shows exactly what he
    // typed, not the internal instruction appended to it.
    const historyForStorage = hyperfocusTrigger
      ? updatedHistory.map((entry, i) =>
          i === updatedHistory.length - 1 ? { ...entry, content: message } : entry
        )
      : updatedHistory;

    // Store which model actually answered and token usage alongside the
    // message itself, so "who answered" and token count survive a page
    // reload — not just visible on the live response.
    const finalHistory = [
      ...historyForStorage,
      { role: 'assistant', content: reply, model: answeredModel, usage },
    ];
    await saveRecent(finalHistory);

    return res.status(200).json({
      reply,
      model: answeredModel,
      provider,
      usage,
      degraded,
    });
  } catch (err) {
    console.error('Nex chat handler crashed:', err);
    Sentry.captureException(err);
    await Sentry.flush(2000); // wait for Sentry to actually send before the function ends
    return res.status(500).json({ error: 'Internal system error processing your message.' });
  }
}
