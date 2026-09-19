// api/room-chat.js
// Live-canvas room, v3: generates a real, complete, self-contained HTML
// document per request (inline CSS/JS), streamed token-by-token. Hosted
// Room requests use the Vercel AI Gateway; Forge requests explicitly use the
// signed-in customer's OpenRouter connection and fail closed if it is absent.
// A full page for an ambitious request can genuinely take longer than modelRouter's 90s hard
// timeout ceiling (tuned for normal chat replies, not this), so it uses
// routeMessageStream and owns the longer request deadline itself. This
// Hosted Room routing remains deliberately Gateway-only: removing or
// exhausting a separate direct Anthropic account must never disable it.
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
// v7: Room Builder now owns one draggable conversation dock over the full
// preview. Generated HTML is deliberately free of builder chrome so users
// see one chat surface, and exports/previews stay portable.

import { saveBuild } from '../lib/roomHistory.js';
import { recordProjectSpend } from '../lib/roomProjectLedger.js';
import { getRequestUser } from '../lib/roomAuth.js';
import { getOrCreateAnonId } from '../lib/anonSession.js';
import { roomMeter } from '../lib/roomMetering.js';
import { roomConversations } from '../lib/roomConversation.js';
import { attachmentManifest, attachmentMessageContent, embedRoomAttachments, parseRoomAttachments } from '../lib/roomAttachments.js';
import { routeMessageStream } from '../lib/modelRouter.js';
import { getTenantCredential } from '../lib/tenantCredentials.js';
import { forgeCredentialScope } from '../lib/openRouterConnection.js';
import { routeOpenRouterStream } from '../lib/openRouterRouter.js';

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
- Don't add Room Builder controls or a "talk to Nex" interface inside the generated project. The builder already provides its own conversation dock outside the project. If the request is specifically for a chatbot product or customer-support interface, that interface is part of the requested project and is fine to build.
- When attached images are listed, inspect them and follow the customer's directions. To place one in the page, use its exact NEXUS_IMAGE_N token as the image src; include useful alt text. Never copy base64, invent a URL, or use an attachment the customer did not ask to place.`;

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

Rules for any NEW text: never use localStorage or sessionStorage (the page runs in a sandboxed iframe where they throw errors); keep it self-contained and safe, no requests to localhost or internal networks, no attempts to break out of the iframe. When attached images are listed, inspect them and use the exact NEXUS_IMAGE_N token as src for any image the customer asked to place. Never copy base64 or invent a URL.

If the requested change is too extensive to express as targeted edits (e.g. a full redesign, or restructuring most of the page), instead respond with ONLY the token <<<REWRITE>>> on its own line, followed by the complete new HTML document starting with <!DOCTYPE html>, and nothing else.`;

// Parses one or more <<<OLD>>>/<<<NEW>>>/<<<END>>> blocks out of a
// patch-mode response.
//
// The newline after each marker is OPTIONAL on purpose. This regex used to
// require one (`<<<OLD>>>\r?\n`), and a real customer edit failed because the
// model emitted the markers inline instead:
//
//     <<<OLD>>>  :focus-visible{ ... }</style><<<NEW>>>  :focus-visible{ ...
//
// That is a well-formed edit by every meaning that matters, but zero blocks
// parsed and the whole build was rejected with "could not be applied
// safely". Models will not reliably put a bare delimiter on its own line, so
// the parser tolerates it rather than the customer losing the build.
//
// Whitespace handling is deliberately narrow: a run of spaces/tabs is only
// consumed when it is followed by a newline (i.e. trailing whitespace on the
// marker's own line). Leading indentation that belongs to the content is
// preserved, because OLD text is matched against the document verbatim and
// eating two spaces would turn a good edit into a "could not be matched"
// failure instead.
export function parsePatchBlocks(text) {
  const blocks = [];
  const regex = /<<<OLD>>>(?:[ \t]*\r?\n)?([\s\S]*?)(?:\r?\n)?<<<NEW>>>(?:[ \t]*\r?\n)?([\s\S]*?)(?:\r?\n)?<<<END>>>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ oldText: match[1], newText: match[2] });
  }
  return blocks;
}

export function stripLiveEditWidget(html) {
  return html.replace(
    /<!-- NEXUS_LIVE_EDIT_WIDGET_START -->[\s\S]*?<!-- NEXUS_LIVE_EDIT_WIDGET_END -->\n?/i,
    ''
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { displayMessage, currentHtml, projectId } = req.body || {};
  let attachments;
  try { attachments = parseRoomAttachments(req.body?.attachments); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const typedMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const message = typedMessage || (attachments.length ? 'Use the attached image in the project.' : '');
  if (!message) return res.status(400).json({ error: 'Missing message' });

  const signedInUsername = await getRequestUser(req);
  let username = signedInUsername;
  if (!username) username = getOrCreateAnonId(req, res);

  // Forge explicitly opts into the customer-owned brain path. That path is
  // fail-closed: a missing/invalid customer connection never falls through to
  // the owner's centrally funded AI Gateway key.
  const customerOwnedBrain = req.body?.requireOwnBrain === true;
  let openRouterCredential = null;
  if (customerOwnedBrain) {
    if (!signedInUsername) return res.status(401).json({ error: 'Sign in required.' });
    try {
      openRouterCredential = await getTenantCredential({
        tenantId: forgeCredentialScope({ ownerUsername: signedInUsername, projectId: projectId || 'default' }),
        provider: 'openrouter',
      });
    } catch (credentialError) {
      console.error('room-chat: customer brain lookup failed:', credentialError.message);
      return res.status(503).json({ error: 'Your Builder Brain connection could not be checked. Try again shortly.' });
    }
    if (!openRouterCredential?.accessToken) {
      return res.status(409).json({
        error: 'Connect your Builder Brain before starting this build.',
        code: 'BUILDER_BRAIN_REQUIRED',
      });
    }
  } else if (!process.env.AI_GATEWAY_API_KEY) {
    return res.status(500).json({ error: 'The AI Gateway is not configured for this environment.' });
  }

  let reservation;
  try {
    reservation = await roomMeter.reserveBuild({
      userId: username,
      kind: currentHtml ? 'edit' : 'fresh',
    });
  } catch (meterError) {
    console.error('room-chat: usage meter unavailable:', meterError.message);
    return res.status(503).json({ error: 'Room usage meter is temporarily unavailable. Try again shortly.' });
  }
  if (!reservation.ok) {
    return res.status(429).json({
      error: 'This Room account has reached its build-credit limit for the current period.',
      code: 'ROOM_CREDITS_EXHAUSTED',
      usage: reservation,
    });
  }

  let buildSucceeded = false;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Forward generated text to the client as it arrives, so the canvas can
  // render the build in progress instead of sitting on a spinner until the
  // whole document lands. Coalesced on a short interval: a provider can emit
  // dozens of tiny deltas per second, and one SSE frame each is a lot of
  // per-frame overhead for no visible gain. Display pacing is the client's
  // job (see public/liveCodeStream.js) — this side only forwards.
  //
  // Additive on purpose. The final `html` action and every existing action
  // are unchanged, so a client that ignores `code_delta` behaves exactly as
  // it does today. Nothing here gates, validates, or saves: the truncation
  // and document checks below still run against the complete response, and
  // a build that fails them is still never saved or shown as finished. A
  // delta is a preview of work in progress, never evidence it succeeded.
  let pendingDelta = '';
  let lastDeltaAt = 0;
  const DELTA_FLUSH_MS = 50;
  const flushDelta = (force = false) => {
    if (!pendingDelta) return;
    const now = Date.now();
    if (!force && now - lastDeltaAt < DELTA_FLUSH_MS) return;
    lastDeltaAt = now;
    const text = pendingDelta;
    pendingDelta = '';
    send({ action: 'code_delta', text });
  };

  const isEdit = Boolean(currentHtml);
  const sendBuildError = (reason) => {
    console.error('room-chat: automatic build failed:', reason);
    send({
      action: 'error',
      message: 'The automatic builder could not finish this attempt. Your project was not changed—please try again.',
    });
  };

  // Start the downstream SSE response immediately, then keep it active
  // while Anthropic streams the response to this function.
  send({
    action: 'progress',
    message: isEdit ? 'Updating the current version…' : 'Creating the first working version…',
  });
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
    const generationBody = {
      max_tokens: 16000,
      system: isEdit ? EDIT_SYSTEM_PROMPT : FRESH_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: attachmentMessageContent(isEdit
            ? `Current HTML:\n${currentHtml}\n\nAttached images:\n${attachmentManifest(attachments)}\n\nRequested change: ${message}`
            : `No existing page yet (build from scratch).\n\nAttached images:\n${attachmentManifest(attachments)}\n\nUser request: ${message}`,
          attachments),
        },
      ],
    };
    const { response, provider, model } = customerOwnedBrain
      ? await routeOpenRouterStream({
          apiKey: openRouterCredential.accessToken,
          body: generationBody,
          signal: controller.signal,
        })
      : await routeMessageStream({
          tier: 'heavy',
          claudeModel: process.env.ROOM_BUILDER_MODEL || 'claude-sonnet-5',
          gatewayOnly: true,
          body: generationBody,
          signal: controller.signal,
        });
    console.log('room-chat: streaming build opened through', provider, model);

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
          pendingDelta += parsed.delta.text;
          flushDelta();
        } else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
          stopReason = parsed.delta.stop_reason;
        } else if (typeof parsed.choices?.[0]?.delta?.content === 'string') {
          const text = parsed.choices[0].delta.content;
          raw += text;
          pendingDelta += text;
          flushDelta();
          const finishReason = parsed.choices[0].finish_reason;
          if (finishReason) stopReason = finishReason === 'length' ? 'max_tokens' : finishReason;
        } else if (parsed.choices?.[0]?.finish_reason) {
          const finishReason = parsed.choices[0].finish_reason;
          stopReason = finishReason === 'length' ? 'max_tokens' : finishReason;
        }
      }
    }

    flushDelta(true);
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
        // Distinguish a cut-off response from a malformed one: they need
        // different things from the customer, and the old code reported
        // both as "could not be applied safely", which explains neither.
        if (stopReason === 'max_tokens' || !raw.includes('<<<END>>>')) {
          console.error('room-chat: edit response was cut off before a complete block (stop_reason:', stopReason + ')', 'length:', raw.length);
          sendBuildError('That edit was too large to finish in one pass. Try asking for one change at a time.');
          return;
        }
        console.error('room-chat: patch mode but no parseable OLD/NEW blocks:', raw.slice(0, 400));
        sendBuildError('The builder returned an edit that could not be applied safely.');
        return;
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
        sendBuildError('The requested edit could not be matched safely to the current project.');
        return;
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
      sendBuildError('The builder did not return a complete browser page.');
      return;
    }

    // Real truncation check via Anthropic's own stop_reason, plus a
    // closing-tag backstop — never show or save a half-built page.
    // Only meaningful for raw model output; a patch-reconstructed
    // document was already a complete page before this request.
    if (isRawFullDocument) {
      const truncated = stopReason === 'max_tokens' || !/<\/html>\s*$/i.test(html);
      if (truncated) {
        console.error('room-chat: response was truncated (stop_reason:', stopReason + ')', 'length:', html.length);
        sendBuildError('The requested build exceeded the automatic builder output limit.');
        return;
      }
    }

    html = embedRoomAttachments(stripLiveEditWidget(html), attachments);

    send({ action: 'html', html });
    // Provider work completed, so charge the reserved operation even if
    // history persistence later fails. The actual provider token/cost
    // reconciliation is a later slice; this is the hard ceiling now.
    buildSucceeded = true;

    try {
      const customerMessage = typeof displayMessage === 'string' && displayMessage.trim()
        ? displayMessage.trim()
        : message;
      const saved = await saveBuild(username, {
        label: customerMessage,
        requestMessage: customerMessage,
        html,
        projectId,
      });
      send({ action: 'saved', id: saved.id, projectId: saved.projectId || saved.id });
      if (saved.projectId) {
        try {
          await roomConversations.appendTurns(username, saved.projectId, [
            {
              role: 'assistant',
              text: isEdit
                ? 'The requested update was completed and saved.'
                : 'The first working version was completed and saved.',
            },
          ]);
        } catch (conversationError) {
          console.error('room-chat: completion memory write failed:', conversationError.message);
        }
      }
    } catch (saveErr) {
      console.error('room-chat: failed to save build to history:', saveErr.message);
      send({ action: 'save_error', message: "Built it, but couldn't save it to history — it'll be lost on refresh." });
    }

    send({ action: 'done' });
  } catch (err) {
    clearTimeout(timer);
    console.error('room-chat handler crashed:', err.message);
    if (err.name === 'AbortError') {
      sendBuildError('The requested build exceeded the automatic builder time limit.');
    } else {
      sendBuildError(`The automatic builder failed: ${err.message}`);
    }
  } finally {
    try {
      if (reservation) {
        const settled = await roomMeter.settleBuild({
          userId: username,
          period: reservation.period,
          reservationId: reservation.reservationId,
          success: buildSucceeded,
        });
        // Record what was actually charged against this project, so the
        // work done on it has a real number attached. Uses `charged` and
        // not the reserved amount on purpose: a failed build releases its
        // reservation, and the ledger must never show work that didn't
        // happen. Best-effort — a ledger write must never turn a finished
        // page into an error, and it is not used to gate anything.
        try {
          await recordProjectSpend({
            userId: username,
            projectId,
            credits: settled?.charged,
          });
        } catch (ledgerError) {
          console.error('room-chat: project ledger write failed:', ledgerError.message);
        }
      }
    } catch (meterError) {
      // A failed settlement must be visible in logs; it must never turn a
      // completed page into a user-facing 500 after the stream is built.
      console.error('room-chat: usage settlement failed:', meterError.message);
    }
    clearTimeout(timer);
    clearInterval(heartbeat);
    res.end();
  }
}
