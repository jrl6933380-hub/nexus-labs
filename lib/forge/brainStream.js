// lib/forge/brainStream.js
//
// Routes a Forge build to the customer's own Builder Brain when they have one,
// and to the owner's gateway when they don't.
//
// The design decision worth knowing: this adapts OpenRouter's OpenAI-shaped
// stream into the Anthropic-shaped events the Room Builder already parses, so
// the consumer does not change at all. The alternative — teaching room-chat to
// understand two stream formats — would mean two parsers, two truncation
// checks, and two ways for a build to go subtly wrong. Translating once at the
// boundary keeps exactly one path through the risky part.
//
// Fallback is deliberate and explicit. A customer with no connection uses the
// owner gateway exactly as before, which is what preserves today's behaviour.
// But a customer WITH a connection never silently falls back to the owner's
// credentials if their brain fails: that would mean the owner quietly paying
// for a customer who believes they are paying for themselves. Their failure is
// surfaced as their failure.

import { routeMessageStream } from '../modelRouter.js';
import { getConnection, getProviderKey } from './brainStore.js';
import { modelForTier } from './brainProviders.js';

/** Anthropic-shaped content blocks -> OpenAI-shaped content parts. */
function toOpenAIContent(content) {
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

function toOpenAIMessages({ system, messages }) {
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
function adaptOpenAIStream(upstream) {
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
      const { value, done } = await reader.read();
      if (done) {
        closed = true;
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';

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
        }
        if (choice?.finish_reason) {
          const stop = choice.finish_reason === 'length' ? 'max_tokens' : choice.finish_reason;
          emit(controller, { type: 'message_delta', delta: { stop_reason: stop } });
        }
      }
    },
    cancel(reason) {
      closed = true;
      reader.cancel(reason).catch(() => {});
    },
  });
}

/**
 * Open a build stream for this user.
 *
 * @returns {{ response: { body: ReadableStream }, provider: string, model: string, byo: boolean }}
 */
export async function openBuildStream({ username, body, signal, ownerOptions = {} }) {
  let connection = null;
  if (username) {
    // A storage failure here must not take a build down. It means we could not
    // confirm a connection, which is the same position as not having one.
    try { connection = await getConnection(username); } catch { connection = null; }
  }

  if (!connection?.connected) {
    const result = await routeMessageStream({ ...ownerOptions, body, signal });
    return { ...result, byo: false };
  }

  const key = await getProviderKey(username);
  if (!key) {
    // The record says connected but no key decrypts — a rotated encryption key
    // is the usual cause. Fail loudly rather than quietly billing the owner.
    throw new Error('Your Builder Brain could not be read. Reconnecting it should fix this.');
  }

  const model = modelForTier(connection.provider || 'openrouter', connection.tier || 'free');
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
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: body.max_tokens,
      messages: toOpenAIMessages(body),
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    // Map the cases a customer can actually act on. Everything else stays
    // generic rather than leaking a provider payload into the build view.
    if (response.status === 402) {
      throw new Error('Your Builder Brain is out of credit. Add some at OpenRouter, or switch to Free.');
    }
    if (response.status === 401) {
      throw new Error('Your Builder Brain was rejected. Reconnecting it should fix this.');
    }
    if (response.status === 429) {
      throw new Error("Your Builder Brain hit its rate limit. Give it a minute, or switch to a paid option for more room.");
    }
    console.error('forge brain stream failed:', response.status, detail.slice(0, 200));
    throw new Error('Your Builder Brain could not start that build.');
  }

  return {
    response: { body: adaptOpenAIStream(response.body) },
    provider: connection.provider || 'openrouter',
    model,
    byo: true,
  };
}
