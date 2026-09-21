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

const COMPACT_SUFFIX = `\n\nOUTPUT BUDGET — IMPORTANT\nYou have a modest output ceiling on this build. Produce ONE complete, genuinely working page that fits comfortably: the core layout and the single most important interaction, fully finished and properly closed. Prefer fewer sections done completely over many sections cut off. Always finish with a closing </html> tag. A smaller page that is complete is the goal; an elaborate one that stops mid-file is a failure.`;

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
function continuedStream(firstBody, { openRound, baseMessages }) {
  const encoder = new TextEncoder();
  let currentBody = firstBody;
  let round = 1;
  let accumulated = '';
  let closed = false;

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
  async function drainRound(controller) {
    const reader = adaptOpenAIStream(currentBody).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason = null;
    let roundText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
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
          roundText += text;
          accumulated += text;
          emitText(controller, text);
        } else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
          finishReason = parsed.delta.stop_reason;
        }
      }
    }
    return finishReason;
  }

  return new ReadableStream({
    async pull(controller) {
      if (closed) return;
      try {
        const finishReason = await drainRound(controller);
        const truncated = finishReason === 'max_tokens';
        const canContinue = truncated
          && !looksComplete(accumulated)
          && round < MAX_CONTINUATION_ROUNDS;

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
        controller.close();
      } catch (error) {
        closed = true;
        controller.error(error);
      }
    },
    cancel(reason) {
      closed = true;
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

  const model = modelForTier(connection.provider || 'openrouter', connection.tier || 'free');
  // A free-router model can spend the whole small budget on hidden reasoning
  // and return HTTP 200 with empty visible content. Retry only that case,
  // once, with a larger bounded budget. Never retry paid errors or rate limits.
  for (let attempt = 0; attempt < 2; attempt++) {
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
        throw new Error('Your Builder Brain is out of credit. Add some at OpenRouter, or switch to Free.');
      }
      if (response.status === 401) {
        throw new NoBrainError('Your Builder Brain was rejected. Reconnecting it should fix this.');
      }
      if (response.status === 429) {
        throw new Error("Your Builder Brain hit its rate limit. Give it a minute, or switch to a paid option for more room.");
      }
      console.error('forge brain request failed:', response.status, detail.slice(0, 200));
      throw new Error('Your Builder Brain could not answer that.');
    }

    const data = await response.json().catch(() => ({}));
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text === 'string' && text.trim()) {
      return { text, provider: connection.provider || 'openrouter', model };
    }
    console.warn('forge brain empty response:', model, data?.choices?.[0]?.finish_reason || 'unknown',
      data?.usage?.completion_tokens_details?.reasoning_tokens ?? 'unknown');
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
export async function openBuildStream({ username, body, signal }) {
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
  const model = modelForTier(connection.provider || 'openrouter', tier);
  const budget = budgetForTier(tier);

  // On a small-ceiling tier, tell the builder to aim for something that
  // actually fits. Continuation below rescues an overrun, but a build that
  // lands in one pass is faster and cheaper than one rescued in three.
  const system = budget.compact ? `${body.system}${COMPACT_SUFFIX}` : body.system;
  const baseMessages = toOpenAIMessages({ ...body, system });
  const maxTokens = Math.min(body.max_tokens ?? budget.maxTokens, budget.maxTokens);

  const openRound = async (messages) => {
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
        throw new Error('Your Builder Brain is out of credit. Add some at OpenRouter, or switch to Free.');
      }
      if (response.status === 401) {
        throw new NoBrainError('Your Builder Brain was rejected. Reconnecting it should fix this.');
      }
      if (response.status === 429) {
        throw new Error("Your Builder Brain hit its rate limit. Give it a minute, or switch to a paid option for more room.");
      }
      console.error('forge brain stream failed:', response.status, detail.slice(0, 200));
      throw new Error('Your Builder Brain could not start that build.');
    }
    return response;
  };

  // First round opens eagerly so a hard failure (402/401/429) still throws
  // before any stream is handed back to the caller.
  const firstResponse = await openRound(baseMessages);

  return {
    response: { body: continuedStream(firstResponse.body, { openRound, baseMessages }) },
    provider: connection.provider || 'openrouter',
    model,
    byo: true,
  };
}
