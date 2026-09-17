import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [brain, chatBar] = await Promise.all([
  readFile(new URL('../lib/nexBrain.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/nex-chat-bar.js', import.meta.url), 'utf8'),
]);

test('crew-mode PR creation requires a successful preflight', () => {
  assert.match(brain, /toolContext\.crewStatus !== 'ready'/u);
  assert.match(brain, /crewStatus: crew\?\.status \|\| null/u);
});

test('provider-unavailable safe mode persists a resumable waiting checkpoint', () => {
  assert.match(brain, /blocker: 'provider_unavailable'/u);
  assert.match(brain, /persistNexRunState\(runState\)/u);
});

test('blocked runs are not silently resumed by the browser client', () => {
  assert.match(chatBar, /\['completed', 'blocked', 'cancelled', 'failed'\]/u);
});
