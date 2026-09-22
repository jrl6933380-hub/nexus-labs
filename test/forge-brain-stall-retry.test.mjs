import test from 'node:test';
import assert from 'node:assert/strict';

import { continuedStream } from '../lib/forge/brainStream.js';

// Simulates a free-router model that spends its whole budget on hidden
// reasoning tokens: the connection opens but nothing is ever enqueued.
function upstreamThatNeverSends() {
  return new ReadableStream({ start() {} });
}

function upstreamFrom(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const sse = (object) => `data: ${JSON.stringify(object)}\n\n`;
const delta = (text) => sse({ choices: [{ delta: { content: text } }] });
const stop = () => sse({ choices: [{ delta: {}, finish_reason: 'stop' }] });

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let error = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const evt of events) {
        const line = evt.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const parsed = JSON.parse(line.slice(6));
        if (parsed.type === 'content_block_delta') raw += parsed.delta.text;
      }
    }
  } catch (err) {
    error = err;
  }
  return { raw, error };
}

test('round 1 stalling with no visible output retries with a fresh model pick', async () => {
  let openRoundCalls = 0;
  const openRound = async () => {
    openRoundCalls += 1;
    // First retry also stalls; the next one is the good model.
    const body = openRoundCalls === 1
      ? upstreamThatNeverSends()
      : upstreamFrom([delta('<!doctype html>'), delta('<html></html>'), stop()]);
    return { body };
  };

  const stream = continuedStream(upstreamThatNeverSends(), {
    openRound,
    baseMessages: [{ role: 'user', content: 'test' }],
    stallTimeoutMs: 15,
    maxStallRetries: 2,
  });

  const { raw, error } = await readAll(stream);
  assert.equal(error, null, 'a build that eventually gets a real model must not error out');
  assert.equal(raw, '<!doctype html><html></html>');
  assert.equal(openRoundCalls, 2, 'the first stalled retry and the successful one');
});

test('a round that stalls on every attempt fails fast with a distinguishable error', async () => {
  const openRound = async () => ({ body: upstreamThatNeverSends() });

  const stream = continuedStream(upstreamThatNeverSends(), {
    openRound,
    baseMessages: [{ role: 'user', content: 'test' }],
    stallTimeoutMs: 15,
    maxStallRetries: 1,
  });

  const { error } = await readAll(stream);
  assert.ok(error, 'expected the stream to error out instead of hanging for the full outer timeout');
  assert.equal(error.code, 'BRAIN_STALLED');
});

test('a pause after visible text has already started is not treated as a stall', async () => {
  let sawDelay = false;
  const openRound = async () => { throw new Error('should not need a retry for normal pacing'); };

  const encoder = new TextEncoder();
  const pacedUpstream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(delta('<!doctype html>')));
      await new Promise((resolve) => setTimeout(resolve, 40));
      sawDelay = true;
      controller.enqueue(encoder.encode(delta('<html></html>')));
      controller.enqueue(encoder.encode(stop()));
      controller.close();
    },
  });

  const stream = continuedStream(pacedUpstream, {
    openRound,
    baseMessages: [{ role: 'user', content: 'test' }],
    stallTimeoutMs: 15,
    maxStallRetries: 2,
  });

  const { raw, error } = await readAll(stream);
  assert.equal(error, null);
  assert.equal(raw, '<!doctype html><html></html>');
  assert.ok(sawDelay, 'the pause needs to actually exceed the stall window for this test to mean anything');
});
