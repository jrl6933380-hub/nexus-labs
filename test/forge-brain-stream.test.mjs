import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptOpenAIStream, continuedStream, toOpenAIMessages } from '../lib/forge/brainStream.js';
import { budgetForTier } from '../lib/forge/brainProviders.js';

function upstreamFrom(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

// Reads the adapted stream using exactly the logic in api/room-chat.js. If
// these two ever drift, these tests stop meaning anything — that duplication
// is deliberate, because the contract being tested IS "room-chat can parse
// this unchanged".
async function readLikeRoomChat(stream) {
  const reader = stream.getReader();
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
      try { parsed = JSON.parse(dataLine.slice(6)); } catch { continue; }
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
        raw += parsed.delta.text;
      } else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
        stopReason = parsed.delta.stop_reason;
      }
    }
  }
  return { raw, stopReason };
}

const sse = (object) => `data: ${JSON.stringify(object)}\n\n`;
const delta = (text) => sse({ choices: [{ delta: { content: text } }] });

test('generated text passes through byte-identically', async () => {
  const document = '<!doctype html>\n<html>\n<body>hi</body>\n</html>';
  const chunks = document.match(/[\s\S]{1,7}/g).map(delta);
  const { raw } = await readLikeRoomChat(adaptOpenAIStream(upstreamFrom(chunks)));
  assert.equal(raw, document, 'a build must survive translation unchanged');
});

test('a network chunk splitting an SSE frame does not stall the build', async () => {
  // This is the regression that mattered: an early version returned from
  // pull() without enqueuing when a read produced no complete frame, and the
  // consumer waited forever. A hung build is worse than a failed one.
  const frame = delta('hello world');
  const cut = Math.floor(frame.length / 2);
  const { raw } = await readLikeRoomChat(
    adaptOpenAIStream(upstreamFrom([frame.slice(0, cut), frame.slice(cut)]))
  );
  assert.equal(raw, 'hello world');
});

test('many frames split at awkward boundaries still reassemble', async () => {
  const document = '<div class="a">one</div>\n<div class="b">two</div>';
  const stream = document.match(/[\s\S]{1,4}/g).map(delta).join('');
  const chunks = stream.match(/[\s\S]{1,13}/g);
  const { raw } = await readLikeRoomChat(adaptOpenAIStream(upstreamFrom(chunks)));
  assert.equal(raw, document);
});

test('finish_reason length maps to max_tokens so truncation is still caught', async () => {
  const chunks = [delta('partial'), sse({ choices: [{ delta: {}, finish_reason: 'length' }] })];
  const { raw, stopReason } = await readLikeRoomChat(adaptOpenAIStream(upstreamFrom(chunks)));
  assert.equal(raw, 'partial');
  assert.equal(stopReason, 'max_tokens', 'room-chat checks for this exact value');
});

test('a normal finish is not reported as truncation', async () => {
  const chunks = [delta('done'), sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })];
  const { stopReason } = await readLikeRoomChat(adaptOpenAIStream(upstreamFrom(chunks)));
  assert.equal(stopReason, 'stop');
});

test('[DONE] and comment keepalives are ignored', async () => {
  const chunks = [delta('a'), ': keepalive\n\n', 'data: [DONE]\n\n'];
  const { raw } = await readLikeRoomChat(adaptOpenAIStream(upstreamFrom(chunks)));
  assert.equal(raw, 'a');
});

test('a malformed frame is skipped without losing the rest of the build', async () => {
  const chunks = [delta('good '), 'data: {not json}\n\n', delta('still good')];
  const { raw } = await readLikeRoomChat(adaptOpenAIStream(upstreamFrom(chunks)));
  assert.equal(raw, 'good still good');
});

test('empty deltas emit nothing', async () => {
  const chunks = [
    sse({ choices: [{ delta: {} }] }),
    sse({ choices: [{ delta: { content: '' } }] }),
    delta('x'),
  ];
  const { raw } = await readLikeRoomChat(adaptOpenAIStream(upstreamFrom(chunks)));
  assert.equal(raw, 'x');
});

test('the patch markers room-chat parses survive intact', async () => {
  const document = '<<<OLD>>>\nred\n<<<NEW>>>\nblue\n<<<END>>>';
  const chunks = document.match(/[\s\S]{1,3}/g).map(delta);
  const { raw } = await readLikeRoomChat(adaptOpenAIStream(upstreamFrom(chunks)));
  assert.equal(raw, document, 'an edit must still be applyable after translation');
});

test('the system prompt becomes a system message', () => {
  const out = toOpenAIMessages({ system: 'SYS', messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(out, [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'hi' },
  ]);
});

test('an image block becomes a data url part', () => {
  const out = toOpenAIMessages({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image', source: { media_type: 'image/jpeg', data: 'QUJD' } },
      ],
    }],
  });
  assert.equal(out[0].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
});

test('an unknown block type is dropped rather than breaking the whole request', () => {
  const out = toOpenAIMessages({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'keep' }, { type: 'weird', x: 1 }] }],
  });
  assert.equal(out[0].content, 'keep');
});

test('free build finishes within its two-round cap when a model keeps truncating', async () => {
  let requests = 0;
  const round = (text) => upstreamFrom([
    delta(text),
    sse({ choices: [{ delta: {}, finish_reason: 'length' }] }),
  ]);
  const { raw, stopReason } = await readLikeRoomChat(continuedStream(round('<!doctype html><html>'), {
    baseMessages: [{ role: 'user', content: 'build a page' }],
    maxRounds: budgetForTier('free').maxRounds,
    openRound: async () => { requests++; return { body: round('<body>unfinished') }; },
  }));
  assert.equal(requests, 1);
  assert.equal(stopReason, 'max_tokens', 'incomplete HTML is never saved as a finished build');
  assert.equal(raw, '<!doctype html><html><body>unfinished');
});
