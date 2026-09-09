import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/story-studio.html',import.meta.url),'utf8');
const api = await readFile(new URL('../api/story-studio.js',import.meta.url),'utf8');

test('Story Studio is one locked Nexus canvas cubicle with a private auth gate', () => {
  assert.match(source,/canvasId:'story-studio'/);
  assert.match(source,/locked:true/);
  assert.match(source,/\/room-login\.html\?next=\/story-studio\.html/);
  assert.match(api,/getRequestUser/);
});

test('the first golden path supports chapter input, rights confirmation, generation, editing, saving, export, and deletion', () => {
  for (const marker of ['source-file','source-text','rights-confirmed','generate-btn','Save edits','Export JSON','Delete']) {
    assert.match(source,new RegExp(marker));
  }
  assert.match(source,/action:'generate'/);
  assert.match(source,/action:'save'/);
  assert.match(source,/method:'DELETE'/);
});

test('Story Studio asks for six continuity-aware panels and preserves tenant ownership server-side', () => {
  assert.match(api,/Produce exactly 6 panels/);
  assert.match(api,/appearance/);
  assert.match(api,/continuity/);
  assert.match(api,/store\.saveProject\(username/);
  assert.doesNotMatch(api,/req\.body\?\.userId/);
});
