// api/room-chat.js
// Live-canvas room: turns a chat message into structured site-build
// events, streamed back over SSE so the browser applies them one at a
// time and the site visibly assembles itself. Uses lib/modelRouter.js
// directly (same Anthropic-primary/Gateway-backup failover as the rest
// of Nexus) rather than nexBrain's tool loop — this is a narrow,
// stateless JSON-generation task, not a Nex conversation, and doesn't
// touch the board/memory/repo tools.

import { routeMessage } from '../lib/modelRouter.js';

const SYSTEM_PROMPT = `You build small business websites by emitting structured edit events.

Respond with ONLY a JSON array of events, nothing else — no prose, no markdown fences. If the request is genuinely outside what these events can express, respond with an empty array [] rather than a made-up event.

Each event is one of:
{"action":"add_section","sectionId":"<unique-slug>","type":"hero"|"about"|"gallery"|"contact_form"|"testimonial","props":{...}}
{"action":"update_prop","sectionId":"<id>","field":"<prop name>","value":<any>}
{"action":"remove_section","sectionId":"<id>"}
{"action":"reorder_sections","order":["<id>", ...]}
{"action":"set_theme","field":"accentColor"|"fontFamily"|"backgroundColor","value":"<value>"}

Section props:
- hero: headline, subhead, imageUrl
- about: heading, body
- gallery: images (array of urls)
- contact_form: heading
- testimonial: quote, author

theme fields:
- accentColor: used for headings, links, and button backgrounds within sections (hex color)
- fontFamily: CSS font-family value applied across all sections
- backgroundColor: the page/canvas background behind all sections (hex color or CSS color name — e.g. a request to "make the background red" is set_theme backgroundColor "red" or "#ff0000")

Given the current site state and the user's message, return the minimal set of events needed to make the requested change. Use realistic, specific copy for the client's actual business — never placeholder text like "Lorem ipsum" or generic filler.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message, currentState } = req.body || {};
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
      body: {
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Current site state:\n${JSON.stringify(currentState || {})}\n\nUser request: ${message}`,
          },
        ],
      },
    });

    const textBlock = (data.content || []).find((b) => b.type === 'text');
    const raw = textBlock?.text || '[]';
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let events = [];
    try {
      events = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('room-chat: failed to parse events JSON:', parseErr.message, 'raw:', raw.slice(0, 300));
      send({ action: 'error', message: "Got a response I couldn't parse — try rephrasing that." });
      return res.end();
    }

    for (const event of events) {
      send(event);
      // Small delay between events so the canvas visibly builds
      // section by section instead of popping in all at once.
      await new Promise((r) => setTimeout(r, 500));
    }
    send({ action: 'done' });
  } catch (err) {
    console.error('room-chat handler crashed:', err.message);
    send({ action: 'error', message: 'Something went wrong building that.' });
  } finally {
    res.end();
  }
}
