// api/room-chat.js
// Live-canvas room, v2: Nex generates a real, complete, self-contained
// HTML document per request (inline CSS/JS) instead of picking from a
// fixed menu of site-builder events. The browser renders it directly
// in a sandboxed iframe, so the room can build genuinely anything
// expressible in a browser tab — any website, an interactive game, a
// data tool, a canvas/WebGL effect — not just website sections.
//
// Uses lib/modelRouter.js directly (same Anthropic-primary/Gateway-
// backup failover as the rest of Nexus), not nexBrain's tool loop —
// this is a narrow, stateless generation task.

import { routeMessage } from '../lib/modelRouter.js';
import { saveBuild } from '../lib/roomHistory.js';

// Full self-contained pages — especially anything with real interactive
// JS like a game or canvas animation — can take longer to generate than
// the 45s default timeout in lib/modelRouter.js, which is tuned for
// normal chat replies. Override just for this route via the env param
// routeMessage already accepts, rather than changing the shared default
// for every other caller. 90000ms is the router's own hard cap.
const ROOM_TIMEOUT_ENV = { ...process.env, NEX_PROVIDER_TIMEOUT_MS: '90000' };

// Matches the timeout above with room to spare, so Vercel doesn't kill
// the function before the provider call itself times out.
export const config = {
  maxDuration: 120,
};

const SYSTEM_PROMPT = `You build real, functional, self-contained web pages and mini-apps live, based on what the user asks for. This can be anything renderable in a browser tab: a business website, a landing page, an interactive game, a data visualization, a generative art piece, a utility tool — whatever the user describes.

Respond with ONLY one complete HTML document, starting with <!DOCTYPE html> and nothing before or after it — no explanation, no markdown fences, no commentary.

Rules:
- Put all CSS in a <style> tag and all JS in a <script> tag, both inline in the document. You may load external libraries via <script src="https://cdnjs.cloudflare.com/..."> or similar CDNs when it genuinely helps (e.g. three.js for 3D, chart.js for charts).
- Never use localStorage or sessionStorage — the page runs in a sandboxed iframe where they throw errors. Keep any state in plain JS variables instead.
- If the user is asking to modify something that already exists (the current HTML is provided below), make a real edit: keep everything that wasn't asked to change, and modify only what was. Return the complete updated document, not a diff or a partial snippet.
- If the current HTML is empty, build the request from scratch.
- Make it genuinely complete and functional, not a placeholder or a mockup — real interactivity, real content, real styling. Use specific realistic content (names, copy, colors) suited to what was asked, never lorem ipsum or "TODO" placeholders.
- Keep it self-contained and safe: no requests to localhost or internal networks, no attempts to break out of the iframe or access the parent page.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message, currentHtml } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Missing message' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const { data } = await routeMessage({
      tier: 'standard',
      claudeModel: 'claude-sonnet-5',
      env: ROOM_TIMEOUT_ENV,
      body: {
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: currentHtml
              ? `Current HTML:\n${currentHtml}\n\nUser request: ${message}`
              : `No existing page yet (build from scratch).\n\nUser request: ${message}`,
          },
        ],
      },
    });

    const textBlock = (data.content || []).find((b) => b.type === 'text');
    let html = (textBlock?.text || '').trim();

    // Strip stray markdown fences if the model added them despite
    // instructions not to — cheap safety net, not the primary contract.
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    if (!html.toLowerCase().startsWith('<!doctype') && !html.toLowerCase().startsWith('<html')) {
      console.error('room-chat: response did not look like a full HTML document:', html.slice(0, 200));
      send({ action: 'error', message: "Got a response that wasn't a full page — try rephrasing that." });
      return res.end();
    }

    send({ action: 'html', html });

    try {
      const saved = await saveBuild({ label: message, requestMessage: message, html });
      send({ action: 'saved', id: saved.id });
    } catch (saveErr) {
      // Not fatal to the build itself — the page is on screen either
      // way — but the person loses it on refresh, so say so plainly
      // rather than silently dropping it.
      console.error('room-chat: failed to save build to history:', saveErr.message);
      send({ action: 'save_error', message: "Built it, but couldn't save it to history — it'll be lost on refresh." });
    }

    send({ action: 'done' });
  } catch (err) {
    console.error('room-chat handler crashed:', err.message);
    send({ action: 'error', message: 'Something went wrong building that.' });
  } finally {
    res.end();
  }
}
