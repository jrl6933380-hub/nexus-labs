// lib/forge/brainStream.js
//
// Routes a Forge build to the customer's own Builder Brain.
//
// There is no owner-funded fallback, and that is the product decision, not an
// oversight: Forge is customer-powered so revenue goes into building the
// product instead of funding an AI bill that grows with every signup. A
// customer without a connection is asked to connect one. They are never
// quietly served on the owner's credentials.
//
// The consequence worth being awake to: there is no anonymous trial any more.
// Someone has to sign up and connect before they see a single build. That is
// real signup friction traded for a bill that cannot run away.
//
// The design decision worth knowing: this adapts OpenRouter's OpenAI-shaped
// stream into the Anthropic-shaped events the Room Builder already parses, so
// the consumer does not change at all. The alternative — teaching room-chat to
// understand two stream formats — would mean two parsers, two truncation
// checks, and two ways for a build to go subtly wrong. Translating once at the
// boundary keeps exactly one path through the risky part.

import { getConnection, getProviderKey } from './brainStore.js';
import {
  modelForTier,
  budgetForTier,
  looksComplete,
  stripRepeatedPrefix,
  continuationMessages,
  MAX_CONTINUATION_ROUNDS,
} from './brainProviders.js';
import { pickFreeModel, recordFreeModelStall, recordFreeModelMissing } from './freeModelPool.js';
import { reserveModelCall } from './meterGate.js';

/** Thrown when a build cannot run because the user has no working brain. */
export class NoBrainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoBrainError';
    this.code = 'BRAIN_REQUIRED';
  }
}

/** Anthropic-shaped content blocks -> OpenAI-shaped content parts. Exported for tests. */
export function toOpenAIContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  const parts = [];
  for (const block of content) {
    if (block?.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block?.type === 'image' && block.source?.data) {
      const mediaType = block.source.media_type || 'image/png';
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mediaType};base64,${block.source.data}` },
      });
    }
    // Unknown block types are dropped rather than guessed at: sending a
    // malformed part fails the whole request, losing the parts that were fine.
  }
  return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
}

export function toOpenAIMessages({ system, messages }) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const message of messages || []) {
    out.push({ role: message.role, content: toOpenAIContent(message.content) });
  }
  return out;
}

/**
 * Wraps an OpenAI-style SSE body in a ReadableStream that emits the
 * Anthropic-style events room-chat already understands:
 *   content_block_delta / text_delta   for text
 *   message_delta with stop_reason     at the end
 *
 * finish_reason 'length' is mapped to 'max_tokens' specifically so the existing
 * truncation check keeps working — that check is what stops a cut-off build
 * being saved as if it were complete.
 */
export function adaptOpenAIStream(upstream) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = upstream.getReader();
  let buffer = '';
  let closed = false;

  const emit = (controller, payload) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };

  return new ReadableStream({
    async pull(controller) {
      if (closed) return;
      // Loop until something is emitted or upstream ends. A read frequently
      // lands mid-frame and yields no complete event; returning from pull()
      // without enqueuing can leave the consumer waiting forever, which would
      // hang a build rather than fail it. Verified by test: a frame split
      // across two chunks used to stall here.
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          closed = true;
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        let emitted = false;

        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }

          const choice = parsed?.choices?.[0];
          const text = choice?.delta?.content;
          if (typeof text === 'string' && text.length) {
            emit(controller, { type: 'content_block_delta', delta: { type: 'text_delta', text } });
            emitted = true;
          }
          if (choice?.finish_reason) {
            const stop = choice.finish_reason === 'length' ? 'max_tokens' : choice.finish_reason;
            emit(controller, { type: 'message_delta', delta: { stop_reason: stop } });
            emitted = true;
          }
        }

        if (emitted) return;
      }
    },
    cancel(reason) {
      closed = true;
      reader.cancel(reason).catch(() => {});
    },
  });
}

/**
 * Does this user have a working Builder Brain of their own?
 *
 * Used to decide whether a build should be metered. Build credits exist to
 * cover inference the owner pays for; a customer paying their own provider is
 * not spending that, so charging them a credit would be charging for something
 * Forge is no longer providing.
 *
 * Fails CLOSED on a storage error — an unreadable store means we cannot confirm
 * a connection, and treating that as "has their own brain" would hand out free
 * unmetered builds on the owner's gateway.
 */
export async function hasOwnBrain(username) {
  if (!username) return false;
  try {
    const connection = await getConnection(username);
    return Boolean(connection?.connected);
  } catch {
    return false;
  }
}

const COMPACT_SUFFIX = `\n\nFREE BUILD — FINISH THE FIRST VERSION\nReturn a complete, working HTML page in roughly 2,000-2,500 visible tokens. Start the document immediately. Keep one main screen, short CSS, and only the most important working interaction. Close every tag, including </html>. Save extra screens and features for later edits. Do not use your output budget describing a plan or repeating the request.`;

/**
 * Wraps the round-by-round streams into one continuous stream for the client.
 *
 * A small-ceiling model stops at max_tokens mid-document. Rather than failing
 * the whole build — which is what a customer saw before this — we send the
 * partial document back as the model's own prior turn and ask it to carry on,
 * then keep appending. The client sees one uninterrupted build; it never needs
 * to know a round boundary happened.
 *
 * Safety properties that matter here:
 *  - A hard round cap. A model that never emits </html> cannot loop forever
 *    burning the customer's credit.
 *  - Truncation is only reported on the FINAL round. Emitting max_tokens after
 *    round one would trip room-chat's truncation guard and discard a build
 *    that was about to finish.
 *  - A restarted or overlapping continuation is trimmed before it is emitted,
 *    so a model that ignores "do not repeat" cannot produce a duplicated page.
 */
export function continuedStream(firstBody, { openRound, openStallRetry, baseMessages, maxRounds = MAX_CONTINUATION_ROUNDS, continueOnIncomplete = false, stallTimeoutMs = 25_000, maxStallRetries = 2, firstModel = null, onFinished = null }) {
  const encoder = new TextEncoder();
  let currentBody = firstBody;
  let currentModel = firstModel;
  let round = 1;
  let stallRetries = 0;
  let accumulated = '';
  let closed = false;

  // Stall retries default to "try the same model again" when the caller
  // doesn't supply anything smarter (e.g. a fixed paid-tier model, or the
  // existing tests, which only pass openRound).
  const requestStallRetry = openStallRetry || (async () => ({ body: (await openRound(baseMessages)).body }));

  const emitText = (controller, text) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'content_block_delta', delta: { type: 'text_delta', text },
    })}\n\n`));
  };
  const emitStop = (controller, stopReason) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'message_delta', delta: { stop_reason: stopReason },
    })}\n\n`));
  };

  // Reads one upstream round to completion, emitting text as it arrives.
  //
  // Each read races against stallTimeoutMs. openrouter/free picks a random
  // free model per request, and some of those models spend their whole
  // output budget on hidden reasoning tokens and never emit a single
  // visible byte — indistinguishable from a slow-but-working build without
  // this. A stall before any visible text has arrived is reported back to
  // pull() as `{ stalled: true }` so it can retry with a fresh round (a new
  // fetch to openrouter/free re-rolls which model gets picked). A stall
  // after text has already started is left alone: a pause between tokens is
  // normal pacing, not a hang.
  async function drainRound(controller) {
    const reader = adaptOpenAIStream(currentBody).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason = null;
    let roundText = '';
    let sawVisibleText = false;
    let pendingRead = reader.read();

    while (true) {
      const STALL = Symbol('stall');
      const outcome = await Promise.race([
        pendingRead,
        new Promise((resolve) => setTimeout(() => resolve(STALL), stallTimeoutMs)),
      ]);

      if (outcome === STALL) {
        if (sawVisibleText) continue; // normal pacing pause; keep waiting on the same pending read
        reader.cancel('forge build: round stalled with no visible output').catch(() => {});
        return { stalled: true };
      }

      const { value, done } = outcome;
      if (done) break;
      pendingRead = reader.read();

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const evt of events) {
        const line = evt.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        let parsed;
        try { parsed = JSON.parse(line.slice(6)); } catch { continue; }

        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          let text = parsed.delta.text;
          // Only a continuation round can repeat; round one cannot.
          if (round > 1 && !roundText) {
            text = stripRepeatedPrefix(accumulated, text);
            if (!text) continue;
          }
          if (text) sawVisibleText = true;
          roundText += text;
          accumulated += text;
          emitText(controller, text);
        } else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
          finishReason = parsed.delta.stop_reason;
        }
      }
    }
    return { finishReason };
  }

  return new ReadableStream({
    async pull(controller) {
      if (closed) return;
      try {
        const result = await drainRound(controller);

        if (result.stalled) {
          if (round === 1 && accumulated === '' && stallRetries < maxStallRetries) {
            stallRetries += 1;
            console.log(`forge build: round 1 stalled on ${currentModel || 'unknown model'}, retrying with a fresh model pick (attempt ${stallRetries + 1})`);
            const next = await requestStallRetry({ excludingModel: currentModel });
            currentBody = next.body;
            currentModel = next.model || currentModel;
            return; // pull again with a fresh round 1 attempt
          }
          closed = true;
          const stallError = new Error('Your Builder Brain picked a model that never responded. Try again — it should pick a different one — or switch to a faster Brain option.');
          stallError.code = 'BRAIN_STALLED';
          onFinished?.({ success: false });
          controller.error(stallError);
          return;
        }

        const { finishReason } = result;
        const truncated = finishReason === 'max_tokens';
        const canContinue = (truncated || (continueOnIncomplete && finishReason === 'stop'))
          && !looksComplete(accumulated)
          && round < maxRounds;

        if (canContinue) {
          round += 1;
          console.log(`forge build: continuing, round ${round} (${accumulated.length} chars so far)`);
          const next = await openRound(continuationMessages(baseMessages, accumulated));
          currentBody = next.body;
          return; // pull again for the next round
        }

        // Final round. Report truncation only if the document genuinely did not
        // close, so a build finished across rounds is not thrown away.
        closed = true;
        emitStop(controller, looksComplete(accumulated) ? 'stop' : (finishReason || 'stop'));
        onFinished?.({ success: true });
        controller.close();
      } catch (error) {
        closed = true;
        onFinished?.({ success: false });
        controller.error(error);
      }
    },
    cancel(reason) {
      closed = true;
      // A cancel is a customer closing the tab or navigating away mid-build.
      // The provider call already happened and already cost us, so the
      // reservation is settled rather than left to expire — an abandoned
      // build is still a build we paid for.
      onFinished?.({ success: true });
      currentBody?.cancel?.(reason).catch(() => {});
    },
  });
}

/**
 * Non-streaming counterpart to openBuildStream, for the conversation turn.
 *
 * room-assistant needs one complete JSON decision, not a stream, so it cannot
 * reuse the streaming path. Same rules apply though: the customer's own brain
 * or nothing. Talking to Nex used to run on the owner's gateway even after
 * builds had been migrated, which meant a customer with a perfectly good
 * connection still couldn't hold a conversation once the owner's balance ran
 * out — exactly the dependency this product is meant to remove.
 *
 * @returns {{ text: string, provider: string, model: string }}
 */
export async function askCustomerBrain({ username, body }) {
  if (!username) {
    throw new NoBrainError('Sign in and connect a Builder Brain to talk to Nex.');
  }

  // Metered before any provider call. Every request now runs on a Brain we
  // fund, so there is no longer a request that legitimately skips this.
  // Throws MeterRefusedError carrying customer-ready copy; callers let it
  // propagate rather than translating it again.
  const reservation = await reserveModelCall({ username, kind: 'assistant' });
  try {
    return await askCustomerBrainMetered({ username, body });
  } finally {
    // Settled in `finally` so a provider error still releases the hold
    // rather than leaving it to time out on its TTL.
    await reservation.settle({ success: true });
  }
}

async function askCustomerBrainMetered({ username, body }) {

  let connection = null;
  try {
    connection = await getConnection(username);
  } catch (error) {
    console.error('forge brain lookup failed:', error.message);
    throw new NoBrainError('Could not check your Builder Brain just now. Try again in a moment.');
  }

  if (!connection?.connected) {
    throw new NoBrainError('Connect your Builder Brain to start — it takes one tap and the free option needs no card.');
  }

  const key = await getProviderKey(username);
  if (!key) {
    throw new NoBrainError('Your Builder Brain could not be read. Reconnecting it should fix this.');
  }

  const provider = connection.provider || 'openrouter';
  const tier = connection.tier || 'free';
  const isFreeRouter = tier === 'free' && provider === 'openrouter';
  let model = modelForTier(provider, tier);
  if (isFreeRouter) model = await pickFreeModel();
  // A free-router model can spend the whole small budget on hidden reasoning
  // and return HTTP 200 with empty visible content. Retry that case — with a
  // larger bounded budget and, on the free tier, a different model than the
  // one that just came back empty (see freeModelPool.js). A 429 is also
  // retried, but only after waiting out the limit window (below).
  //
  // WATCH THE REQUEST COUNT. Every attempt here is another call against
  // OpenRouter's free tier, which limits requests per MINUTE. Raising this
  // number once looked like "more resilience" and instead made one customer
  // message fire three rapid calls, rate-limiting itself. Three is the
  // ceiling, each retry is spaced, and nothing else in this loop should add
  // an unspaced request.
  const MAX_ATTEMPTS = 3;
  // Small spacing between empty-answer retries, for the same reason.
  const EMPTY_RETRY_SPACING_MS = 900;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nexus-labs-sigma.vercel.app',
        'X-Title': 'Nexus Forge',
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.max(body.max_tokens || 0, attempt ? 3000 : 1800),
        messages: toOpenAIMessages(body),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 402) {
        const broke = new Error('Your Builder Brain is out of credit. Add some at OpenRouter, or switch to Free.');
        broke.code = 'BRAIN_NO_CREDIT';
        throw broke;
      }
      if (response.status === 401) {
        throw new NoBrainError('Your Builder Brain was rejected. Reconnecting it should fix this.');
      }
      if (response.status === 429) {
        // OpenRouter's free tier limits requests per MINUTE, not just per day,
        // and this loop can fire several calls in quick succession — so a
        // burst can rate-limit itself. Wait out the window and try once more
        // before giving up; a short pause is far better for the customer than
        // an error they can do nothing useful about.
        //
        // Honouring Retry-After matters: guessing a fixed delay either wastes
        // the customer's time or retries too early and burns another slot.
        if (attempt < MAX_ATTEMPTS - 1) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 8000)
            : 2500;
          console.warn(`forge brain rate limited on ${model}; waiting ${waitMs}ms before one more try`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        const limited = new Error("Your Builder Brain hit its rate limit. OpenRouter's free tier allows only a few requests per minute. Give it a minute and try again, add credit at OpenRouter to raise the cap, or switch to a paid Brain option.");
        limited.code = 'BRAIN_RATE_LIMITED';
        throw limited;
      }
      // moved behind paid access). On the free tier that is a stale-allowlist
      // problem, not a customer problem: park the slug and try the next
      // model rather than failing the whole request on it.
      if (response.status === 404 && isFreeRouter && attempt < MAX_ATTEMPTS - 1) {
        console.warn('forge brain model unavailable:', model, detail.slice(0, 160));
        recordFreeModelMissing(model).catch(() => {});
        model = await pickFreeModel({ excluding: [model] });
        continue;
      }
      console.error('forge brain request failed:', response.status, detail.slice(0, 200));
      throw new Error('Your Builder Brain could not answer that.');
    }

    const data = await response.json().catch(() => ({}));
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text === 'string' && text.trim()) {
      return { text, provider, model };
    }
    console.warn('forge brain empty response:', model, data?.choices?.[0]?.finish_reason || 'unknown',
      data?.usage?.completion_tokens_details?.reasoning_tokens ?? 'unknown');
    if (isFreeRouter) {
      recordFreeModelStall(model).catch(() => {});
      model = await pickFreeModel({ excluding: [model] });
    }
    // Space the next attempt so a run of empty answers doesn't turn into a
    // burst that trips the per-minute limit on top of the original problem.
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, EMPTY_RETRY_SPACING_MS));
    }
  }
  const error = new Error('Your Builder Brain returned an empty answer.');
  error.code = 'BRAIN_EMPTY';
  throw error;
}

/**
 * Open a build stream for this user.
 *
 * @returns {{ response: { body: ReadableStream }, provider: string, model: string, byo: boolean }}
 */
export async function openBuildStream({ username, body, signal, isEdit = false }) {
  if (!username) {
    throw new NoBrainError('Sign in and connect a Builder Brain to start building.');
  }

  let connection = null;
  try {
    connection = await getConnection(username);
  } catch (error) {
    // Cannot confirm a connection. Refuse rather than guess — there is nothing
    // to fall back to, so guessing would only produce a confusing failure later.
    console.error('forge brain lookup failed:', error.message);
    throw new NoBrainError('Could not check your Builder Brain just now. Try again in a moment.');
  }

  if (!connection?.connected) {
    throw new NoBrainError('Connect your Builder Brain to start building — it takes one tap and the free option needs no card.');
  }

  const key = await getProviderKey(username);
  if (!key) {
    // The record says connected but no key decrypts — a rotated encryption key
    // is the usual cause.
    throw new NoBrainError('Your Builder Brain could not be read. Reconnecting it should fix this.');
  }

  const tier = connection.tier || 'free';
  const provider = connection.provider || 'openrouter';
  // openrouter/free is OpenRouter's own black-box router (see
  // freeModelPool.js for the full reasoning) — on the free tier we pick
  // from our own curated pool instead of trusting it.
  const isFreeRouter = tier === 'free' && provider === 'openrouter';
  const staticModel = modelForTier(provider, tier);
  const budget = budgetForTier(tier);

  // On a small-ceiling tier, tell the builder to aim for something that
  // actually fits. Continuation below rescues an overrun, but a build that
  // lands in one pass is faster and cheaper than one rescued in three.
  const system = budget.compact ? `${body.system}${COMPACT_SUFFIX}` : body.system;
  const baseMessages = toOpenAIMessages({ ...body, system });
  const maxTokens = Math.min(body.max_tokens ?? budget.maxTokens, budget.maxTokens);

  const fetchModel = async (messages, model) => {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        // OpenRouter uses these for attribution on the user's own dashboard.
        'HTTP-Referer': 'https://nexus-labs-sigma.vercel.app',
        'X-Title': 'Nexus Forge',
      },
      body: JSON.stringify({ model, stream: true, max_tokens: maxTokens, messages }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      // Map the cases a customer can actually act on. Everything else stays
      // generic rather than leaking a provider payload into the build view.
      if (response.status === 402) {
        const broke = new Error('Your Builder Brain is out of credit. Add some at OpenRouter, or switch to Free.');
        broke.code = 'BRAIN_NO_CREDIT';
        throw broke;
      }
      if (response.status === 401) {
        throw new NoBrainError('Your Builder Brain was rejected. Reconnecting it should fix this.');
      }
      if (response.status === 429) {
        const limited = new Error("Your Builder Brain hit its rate limit. OpenRouter's free tier allows only a small number of requests per minute and per day. Wait a minute and try again, add credit at OpenRouter to raise the cap, or switch to a paid Brain option.");
        limited.code = 'BRAIN_RATE_LIMITED';
        throw limited;
      }
      if (response.status === 404) {
        // The slug is gone from OpenRouter's catalog. Signal it so the caller
        // can park it and roll a different model instead of failing the build.
        console.warn('forge brain model unavailable:', model, detail.slice(0, 160));
        const missing = new Error('That model is no longer available.');
        missing.code = 'MODEL_MISSING';
        missing.model = model;
        throw missing;
      }
      console.error('forge brain stream failed:', response.status, detail.slice(0, 200));
      throw new Error('Your Builder Brain could not start that build.');
    }
    return response;
  };

  let currentModel = isFreeRouter ? await pickFreeModel() : staticModel;

  // Opens a round, rotating past any free-tier slug that has been retired
  // from OpenRouter's catalog. Without this a single stale allowlist entry
  // fails the whole build, which is exactly what happened when this pool's
  // first slug list turned out to be wrong.
  const fetchWithRotation = async (messages) => {
    const MAX_MODEL_ROTATIONS = 3;
    const tried = [];
    for (let rotation = 0; ; rotation++) {
      try {
        return await fetchModel(messages, currentModel);
      } catch (error) {
        if (error?.code !== 'MODEL_MISSING' || !isFreeRouter || rotation >= MAX_MODEL_ROTATIONS) {
          if (error?.code === 'MODEL_MISSING') {
            throw new Error('Your Builder Brain could not start that build.');
          }
          throw error;
        }
        recordFreeModelMissing(error.model).catch(() => {});
        tried.push(error.model);
        currentModel = await pickFreeModel({ excluding: tried });
      }
    }
  };

  // Continuation rounds (the model ran out of room mid-document) stay on
  // the same model — it's continuing its own output, not starting fresh.
  const openRound = async (messages) => fetchModel(messages, currentModel);

  // A stall retry is different: nothing usable came back, so there's no
  // continuity to preserve. On the free tier, record the cooldown and roll
  // a fresh model excluding the one that just went silent; on a paid tier
  // there's only the one model, so this just tries it again.
  const openStallRetry = async ({ excludingModel }) => {
    if (isFreeRouter) {
      if (excludingModel) recordFreeModelStall(excludingModel).catch(() => {});
      currentModel = await pickFreeModel({ excluding: excludingModel ? [excludingModel] : [] });
    }
    const response = await fetchWithRotation(baseMessages);
    return { body: response.body, model: currentModel };
  };

  // First round opens eagerly so a hard failure (402/401/429) still throws
  // before any stream is handed back to the caller.
  const firstResponse = await fetchWithRotation(baseMessages);

  return {
    response: { body: continuedStream(firstResponse.body, {
      openRound, openStallRetry, baseMessages, maxRounds: budget.maxRounds,
      continueOnIncomplete: !isEdit, firstModel: currentModel,
    }) },
    provider,
    model: currentModel,
    byo: true,
  };
}
