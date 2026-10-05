import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const customerGenerationFiles = [
  '../api/room-chat.js',
  '../api/site-agent-chat.js',
  '../lib/forgeSitePreview.js',
  '../lib/memory.js',
];

test('customer generation and memory compression use the centralized AI Gateway', async () => {
  for (const path of customerGenerationFiles) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /api\.anthropic\.com/, `${path} bypasses the Gateway`);
    assert.doesNotMatch(source, /ANTHROPIC_API_KEY/, `${path} still requires a separate Anthropic balance`);
  }
});

