// api/room-chat.js
// Live-canvas room, v3: generates a real, complete, self-contained HTML
// document per request (inline CSS/JS), streamed token-by-token from
// the Anthropic API directly rather than via lib/modelRouter.js's
// blocking routeMessage(). A full page for an ambitious request can
// genuinely take longer to generate than modelRouter's 90s hard
// timeout ceiling (tuned for normal chat replies, not this) — streaming
// isn't bound by that same fixed-timeout failure mode. Trade-off: this
// route loses the Anthropic->AI-Gateway failover routeMessage() gives
// other callers; acceptable since Gateway currently 403s anyway
// (customer_verification_required — needs a card on file, a Vercel
// account/billing matter, not something fixable in code).
//
// v4: follow-up edits (currentHtml present) now ask for a small patch
// instead of a full-document rewrite. Re-sending and re-generating the
// ENTIRE page for something like "make the background red" was slow
// and, for pages near the size ceiling, could tip a small change into
// a truncation failure that the original build never had. A patch is
// a few lines instead of a few hundred, so it's fast and doesn't
// re-risk the size limit that only the fresh build actually needs.
//
// v5: requires a signed-in session (see lib/roomAuth.js) — builds are
// now saved per-user, not to one shared global history.
//
// v6: every generated page gets a real, working "talk to Nex" widget
// injected server-side (see injectLiveEditWidget below) — a small
// floating circle that expands into a chat input, present whether or
// not the generated page has its own chat-style UI. This is injected
// rather than left to the model to build, because a model-authored
// chat UI can look convincing while not actually being wired to
// anything (this is literally what happened with an earlier "Jarvis"
// build) — the injected widget is fixed, tested once, and guaranteed
// to work the same way every time.

import { saveBuild } from '../lib/roomHistory.js';
import { getRequestUser } from '../lib/roomAuth.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

// Comfortably inside Vercel's function ceiling below, so a slow
// generation gets a clear timeout message instead of the platform
// killing the function first.
const STREAM_TIMEOUT_MS = 110_000;

export const config = {
  maxDuration: 120,
};

const FRESH_SYSTEM_PROMPT = `You build real, functional, self-contained web pages and mini-apps live, based on what the user asks for. This can be anything renderable in a browser tab: a business website, a landing page, an interactive game, a data visualization, a generative art piece, a utility tool — whatever the user describes.

Respond with ONLY one complete HTML document, starting with <!DOCTYPE html> and nothing before or after it — no explanation, no markdown fences, no commentary.

Rules:
- Put all CSS in a <style> tag and all JS in a <script> tag, both inline in the document. You may load external libraries via <script src="https://cdnjs.cloudflare.com/..."> or similar CDNs when it genuinely helps (e.g. three.js for 3D, chart.js for charts).
- Never use localStorage or sessionStorage — the page runs in a sandboxed iframe where they throw errors. Keep any state in plain JS variables instead.
- Make it genuinely complete and functional, not a placeholder or a mockup — real interactivity, real content, real styling. Use specific realistic content (names, copy, colors) suited to what was asked, never lorem ipsum or "TODO" placeholders.
- Keep it self-contained and safe: no requests to localhost or internal networks, no attempts to break out of the iframe or access the parent page.
- You have a real output budget, not infinite. If a request implies many features (multiple screens, a quiz engine, animations, a scoring system, etc.), deliberately scope down to ONE genuinely complete, working version first — the core layout and the single most important interaction, fully working — rather than attempting everything and running out of room half-finished. A simpler page that fully works beats an elaborate one that's cut off mid-file. The person can always ask you to add more in a follow-up, and follow-ups are cheap — they only touch what's changing, not the whole page.
- Don't build your own "chat with an assistant" or "talk to Nex" interface — a real one is added automatically after your page is generated. If the request wants an in-world chat UI for its OWN purpose (e.g. a customer-support demo, a chatbot product mockup), that's fine to build — just don't try to wire it to anything real.`;

// Used for every message after the first — editing something that
// already exists. Patch format instead of a full-document rewrite, for
// the reasons in the header comment above.
const EDIT_SYSTEM_PROMPT = `You are making a targeted edit to an existing web page. You will be given the current full HTML and a description of the change to make.

Respond with one or more edit blocks in exactly this format, and nothing else — no explanation, no markdown fences:

<<<OLD>>>
(the exact contiguous text copied verbatim from the current HTML that will be replaced — keep it as short as possible while still unique enough in the document to identify the right spot; include a little surrounding context if the text you want to change could appear more than once)
<<<NEW>>>
(the replacement text)
<<<END>>>

Include multiple edit blocks back to back for multiple separate changes in the same response. Keep every OLD block copied exactly, character for character, from the current HTML — it will be matched verbatim.

Rules for any NEW text: never use localStorage or sessionStorage (the page runs in a sandboxed iframe where they throw errors); keep it self-contained and safe, no requests to localhost or internal networks, no attempts to break out of the iframe. Don't touch anything between the NEXUS_LIVE_EDIT_WIDGET_START/END comment markers if you see them in the current HTML — that's an injected, working chat widget, not part of the page you're editing.

If the requested change is too extensive to express as targeted edits (e.g. a full redesign, or restructuring most of the page), instead respond with ONLY the token <<<REWRITE>>> on its own line, followed by the complete new HTML document starting with <!DOCTYPE html>, and nothing else.`;

// Parses one or more <<<OLD>>>/<<<NEW>>>/<<<END>>> blocks out of a
// patch-mode response.
function parsePatchBlocks(text) {
  const blocks = [];
  const regex = /<<<OLD>>>\r?\n([\s\S]*?)\r?\n<<<NEW>>>\r?\n([\s\S]*?)\r?\n<<<END>>>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ oldText: match[1], newText: match[2] });
  }
  return blocks;
}

// A real, working "talk to Nex" widget, injected into every generated
// page rather than left to the model. font-size:16px on the input
// avoids iOS Safari's zoom-on-focus (see nexus-stark.css for the same
// fix applied to the rest of the app). Sends messages to the parent
// window via postMessage — works even though the iframe is sandboxed
// without allow-same-origin, since postMessage is exempt from that
// restriction by design.
const LIVE_EDIT_WIDGET = `<!-- NEXUS_LIVE_EDIT_WIDGET_START -->
<div id="nexus-live-edit-widget" style="position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:-apple-system,system-ui,sans-serif;">
  <button id="nexus-live-edit-toggle" type="button" aria-label="Talk to Nex" style="width:52px;height:52px;border-radius:50%;background:#2E7FFF;border:none;box-shadow:0 4px 18px rgba(0,0,0,0.35);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;padding:0;">💬</button>
  <div id="nexus-live-edit-panel" style="display:none;position:absolute;bottom:64px;right:0;width:250px;background:#12192A;border:1px solid #1F2B42;border-radius:12px;padding:10px;box-shadow:0 8px 26px rgba(0,0,0,0.45);">
    <div style="font-size:11px;color:#8891A3;margin-bottom:6px;font-family:'JetBrains Mono',monospace;">Talk to Nex to edit this page</div>
    <input id="nexus-live-edit-input" type="text" placeholder="Describe a change..." style="width:100%;padding:9px 10px;border-radius:6px;border:1px solid #1F2B42;background:#0A0E14;color:#E4E9F2;font-size:16px;box-sizing:border-box;outline:none;">
  </div>
</div>
<script>
(function(){
  var toggle = document.getElementById('nexus-live-edit-toggle');
  var panel = document.getElementById('nexus-live-edit-panel');
  var input = document.getElementById('nexus-live-edit-input');
  if (!toggle || !panel || !input) return;
  toggle.addEventListener('click', function(){
    var opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) input.focus();
  });
  input.addEventListener('keydown', function(e){
    if (e.key === 'Enter' && input.value.trim()) {
      try {
        window.parent.postMessage({ source: 'nexus-live-edit-widget', message: input.value.trim() }, '*');
      } catch (err) {}
      input.value = '';
      panel.style.display = 'none';
    }
  });
})();
</script>
<!-- NEXUS_LIVE_EDIT_WIDGET_END -->`;

function injectLiveEditWidget(html) {
  // Strip any prior copy first (idempotent) — a patch-mode edit on a
  // page that already has the widget shouldn't end up with two.
  const withoutExisting = html.replace(
    /<!-- NEXUS_LIVE_EDIT_WIDGET_START -->[\s\S]*?<!-- NEXUS_LIVE_EDIT_WIDGET_END -->\n?/i,
    ''
  );
  if (/<\/body>/i.test(withoutExisting)) {
    return withoutExisting.replace(/<\/body>/i, LIVE_EDIT_WIDGET + '\n</body>');
  }
  return withoutExisting + '\n' + LIVE_EDIT_WIDGET;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message, currentHtml } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Missing message' });

  const username = await getRequestUser(req);
  if (!username) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured for this environment.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const isEdit = Boolean(currentHtml);

  // Start the downstream SSE response immediately, then keep it active
  // while Anthropic streams the response to this function.
  send({ action: 'progress', message: isEdit ? 'Applying that…' : 'Building…' });
  const heartbeat = setInterval(() => {
    send({
      action: 'progress',
      message: isEdit
        ? 'Still working on that edit…'
        : 'Still building… interactive projects can take a minute.',
    });
  }, 15_000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 16000,
        stream: true,
        system: isEdit ? EDIT_SYSTEM_PROMPT : FRESH_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: isEdit
              ? `Current HTML:\n${currentHtml}\n\nRequested change: ${message}`
              : `No existing page yet (build from scratch).\n\nUser request: ${message}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const bodyText = await response.text().catch(() => '');
      console.error('room-chat: anthropic streaming request failed', response.status, bodyText.slice(0, 300));
      send({ action: 'error', message: 'Something went wrong reaching the model — try again in a moment.' });
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let raw = '';
    let stopReason = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const evt of events) {
        const dataLine = evt.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        let parsed;
        try {
          parsed = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          raw += parsed.delta.text;
        } else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
          stopReason = parsed.delta.stop_reason;
        }
      }
    }

    clearTimeout(timer);

    // Strip stray markdown fences if the model added them despite
    // instructions not to — cheap safety net, not the primary contract.
    raw = raw.trim().replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let html;
    let isRawFullDocument; // whether `html` came straight from the model (subject to the stop_reason truncation check) vs. was reconstructed by applying patches to a document that was already known-good

    if (isEdit && raw.startsWith('<<<REWRITE>>>')) {
      html = raw.slice('<<<REWRITE>>>'.length).trim();
      isRawFullDocument = true;
    } else if (isEdit && raw.includes('<<<OLD>>>')) {
      const patches = parsePatchBlocks(raw);
      if (patches.length === 0) {
        console.error('room-chat: patch mode but no parseable OLD/NEW blocks:', raw.slice(0, 200));
        send({ action: 'error', message: "Got a response I couldn't apply — try rephrasing that." });
        return res.end();
      }
      let working = currentHtml;
      const notFound = [];
      for (const { oldText, newText } of patches) {
        if (!working.includes(oldText)) {
          notFound.push(oldText.slice(0, 60));
          continue;
        }
        working = working.replace(oldText, newText);
      }
      if (notFound.length > 0) {
        console.error('room-chat: patch text not found in current HTML:', notFound);
        send({
          action: 'error',
          message: "Couldn't locate part of what to change — try describing it a bit more specifically (e.g. which section, or what it currently says).",
        });
        return res.end();
      }
      html = working;
      isRawFullDocument = false;
    } else {
      // Fresh build, or an edit response that ignored the patch format
      // and returned a full document directly — treat either as the
      // raw model output.
      html = raw;
      isRawFullDocument = true;
    }

    if (!html.toLowerCase().startsWith('<!doctype') && !html.toLowerCase().startsWith('<html')) {
      console.error('room-chat: response did not look like a full HTML document:', html.slice(0, 200));
      send({ action: 'error', message: "Got a response that wasn't a full page — try rephrasing that." });
      return res.end();
    }

    // Real truncation check via Anthropic's own stop_reason, plus a
    // closing-tag backstop — never show or save a half-built page.
    // Only meaningful for raw model output; a patch-reconstructed
    // document was already a complete page before this request.
    if (isRawFullDocument) {
      const truncated = stopReason === 'max_tokens' || !/<\/html>\s*$/i.test(html);
      if (truncated) {
        console.error('room-chat: response was truncated (stop_reason:', stopReason + ')', 'length:', html.length);
        send({
          action: 'error',
          message: "That build was too ambitious to finish in one response — it got cut off partway through. Try asking for something a bit simpler, or break it into fewer features at once (e.g. build the core page first, then ask to add the quiz/animations after).",
        });
        return res.end();
      }
    }

    html = injectLiveEditWidget(html);

    send({ action: 'html', html });

    try {
      const saved = await saveBuild(username, { label: message, requestMessage: message, html });
      send({ action: 'saved', id: saved.id });
    } catch (saveErr) {
      console.error('room-chat: failed to save build to history:', saveErr.message);
      send({ action: 'save_error', message: "Built it, but couldn't save it to history — it'll be lost on refresh." });
    }

    send({ action: 'done' });
  } catch (err) {
    clearTimeout(timer);
    console.error('room-chat handler crashed:', err.message);
    if (err.name === 'AbortError') {
      send({ action: 'error', message: 'That took too long to build (over ~110 seconds) — try asking for something a bit simpler.' });
    } else {
      send({ action: 'error', message: 'Something went wrong building that.' });
    }
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    res.end();
  }
}
