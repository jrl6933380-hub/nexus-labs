import test from 'node:test';
import assert from 'node:assert/strict';

import { attachVisualFrame, compactModelHistory, formatLiveWorkspaceContext } from '../lib/nexBrain.js';
import { readFile } from 'node:fs/promises';

const nexBrainSource = await readFile(new URL('../lib/nexBrain.js', import.meta.url), 'utf8');

test('an explicitly shared visual frame is attached only to the latest user turn', () => {
  const history = compactModelHistory([
    { role: 'user', content: 'older' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'look at this' },
  ]);
  const framed = attachVisualFrame(history, { media_type: 'image/jpeg', data: 'ZmFrZQ==', width: 800, height: 600 });
  assert.equal(framed[0].content, 'older');
  assert.equal(framed[2].content[0].text, 'look at this');
  assert.equal(framed[2].content[1].type, 'image');
  assert.equal(framed[2].content[1].source.data, 'ZmFrZQ==');
  assert.equal(history[2].content, 'look at this');
});

test('visual context says exactly what was shared without claiming hidden-page access', () => {
  const context = formatLiveWorkspaceContext({
    board: { tasks: [] },
    rooms: [],
    clientContext: { visual: { width: 800, height: 600 } },
  });
  assert.match(context, /explicitly shared a fresh visual frame \(800×600\)/u);
  assert.match(context, /never infer hidden or off-screen content/u);
});

test('no visual frame leaves ordinary text history untouched', () => {
  const history = [{ role: 'user', content: 'plain text' }];
  assert.equal(attachVisualFrame(history, null), history);
});

test('model request keeps multimodal user content instead of filtering the picture out', () => {
  assert.match(nexBrainSource, /Array\.isArray\(msg\.content\) && msg\.content\.some/u);
  assert.match(nexBrainSource, /block\?\.type === 'image'/u);
  assert.match(nexBrainSource, /content: msg\.content/u);
  assert.doesNotMatch(
    nexBrainSource,
    /const claudeMessages = history\s*\.filter\(\(msg\) => typeof msg\.content === 'string'/u
  );
});
