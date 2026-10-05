import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { TOOLS, TOOL_REGISTRY } from '../lib/nexBrain.js';

test('every registered tool is reachable through core preload or tool search', () => {
  const unreachable = TOOLS.map((tool) => tool.name).filter((name) => !TOOL_REGISTRY.get(name)?.reachable);
  assert.deepEqual(unreachable, []);
});

test('gateway-compatible web tools and manual continuity repair have categories', () => {
  assert.equal(TOOL_REGISTRY.get('web_search').category, 'web');
  assert.equal(TOOL_REGISTRY.get('web_fetch').category, 'web');
  assert.equal(TOOL_REGISTRY.get('log_exchange').category, 'continuity');
});

test('every registered tool has an implementation branch', async () => {
  const source = await readFile(new URL('../lib/nexBrain.js', import.meta.url), 'utf8');
  const dispatched = new Set(
    [...source.matchAll(/block\.name === '([^']+)'/gu)].map((match) => match[1]),
  );
  const missing = TOOLS.map((tool) => tool.name).filter((name) => !dispatched.has(name));
  assert.deepEqual(missing, []);
});
