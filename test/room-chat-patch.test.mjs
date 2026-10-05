import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePatchBlocks, stripLiveEditWidget } from '../api/room-chat.js';

test('parses the canonical format with each marker on its own line', () => {
  const blocks = parsePatchBlocks([
    '<<<OLD>>>',
    '<h1>Old title</h1>',
    '<<<NEW>>>',
    '<h1>New title</h1>',
    '<<<END>>>',
  ].join('\n'));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].oldText, '<h1>Old title</h1>');
  assert.equal(blocks[0].newText, '<h1>New title</h1>');
});

test('parses markers emitted inline, which previously failed the whole build', () => {
  // This is the shape that actually broke a live customer edit on
  // 2026-09-16: the model put the content on the same line as <<<OLD>>>
  // and emitted <<<NEW>>> immediately after </style> with no newline.
  // The old regex required \r?\n around every marker, matched zero
  // blocks, and the edit was rejected as "could not be applied safely".
  const raw = '<<<OLD>>>  :focus-visible{\n    outline:3px solid var(--accent);\n  }\n</style><<<NEW>>>  :focus-visible{\n    outline:3px solid var(--accent);\n  }\n  .accent-bar{height:6px;}\n</style><<<END>>>';
  const blocks = parsePatchBlocks(raw);
  assert.equal(blocks.length, 1, 'inline markers must still parse');
  assert.ok(blocks[0].oldText.startsWith('  :focus-visible{'), 'leading indentation must be preserved for verbatim matching');
  assert.ok(blocks[0].oldText.endsWith('</style>'));
  assert.ok(blocks[0].newText.includes('.accent-bar'));
});

test('a parsed inline block still applies verbatim to the source document', () => {
  // Parsing is only half the job — oldText is matched with includes()
  // against the live HTML, so any whitespace the parser eats turns a good
  // edit into a "could not be matched safely" failure instead.
  const html = '<html><head><style>\n  body{margin:0;}\n</style></head><body><h1>Hi</h1></body></html>';
  const raw = '<<<OLD>>>  body{margin:0;}\n</style><<<NEW>>>  body{margin:0;padding:8px;}\n</style><<<END>>>';
  const [block] = parsePatchBlocks(raw);
  assert.ok(html.includes(block.oldText), 'the parsed OLD text must exist verbatim in the document');
  assert.ok(html.replace(block.oldText, block.newText).includes('padding:8px'));
});

test('parses several blocks back to back', () => {
  const raw = [
    '<<<OLD>>>', '<h1>A</h1>', '<<<NEW>>>', '<h1>B</h1>', '<<<END>>>',
    '<<<OLD>>>', '<p>C</p>', '<<<NEW>>>', '<p>D</p>', '<<<END>>>',
  ].join('\n');
  const blocks = parsePatchBlocks(raw);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].oldText, '<p>C</p>');
  assert.equal(blocks[1].newText, '<p>D</p>');
});

test('tolerates trailing spaces and CRLF line endings around markers', () => {
  const raw = '<<<OLD>>>  \r\n<h1>A</h1>\r\n<<<NEW>>>\t\r\n<h1>B</h1>\r\n<<<END>>>';
  const blocks = parsePatchBlocks(raw);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].oldText, '<h1>A</h1>');
  assert.equal(blocks[0].newText, '<h1>B</h1>');
});

test('preserves multi-line content and internal blank lines exactly', () => {
  const raw = '<<<OLD>>>\n<div>\n\n  <span>x</span>\n</div>\n<<<NEW>>>\n<div>\n\n  <span>y</span>\n</div>\n<<<END>>>';
  const [block] = parsePatchBlocks(raw);
  assert.equal(block.oldText, '<div>\n\n  <span>x</span>\n</div>');
  assert.equal(block.newText, '<div>\n\n  <span>y</span>\n</div>');
});

test('an empty NEW block is a valid deletion', () => {
  const raw = '<<<OLD>>>\n<p>remove me</p>\n<<<NEW>>>\n<<<END>>>';
  const [block] = parsePatchBlocks(raw);
  assert.equal(block.oldText, '<p>remove me</p>');
  assert.equal(block.newText, '');
});

test('a response cut off before <<<END>>> yields no blocks rather than a partial edit', () => {
  // The handler treats zero blocks plus a missing <<<END>>> as truncation
  // and says so; what matters here is that a half-written block never
  // becomes an applied edit.
  const raw = '<<<OLD>>>\n<h1>A</h1>\n<<<NEW>>>\n<h1>B';
  assert.deepEqual(parsePatchBlocks(raw), []);
});

test('text with no markers at all yields no blocks', () => {
  assert.deepEqual(parsePatchBlocks('Sure! Here is your updated page.'), []);
  assert.deepEqual(parsePatchBlocks(''), []);
});

test('stripLiveEditWidget removes the injected widget and leaves the rest intact', () => {
  const html = '<body><h1>Hi</h1>\n<!-- NEXUS_LIVE_EDIT_WIDGET_START -->\n<script>x()</script>\n<!-- NEXUS_LIVE_EDIT_WIDGET_END -->\n</body>';
  const stripped = stripLiveEditWidget(html);
  assert.ok(!stripped.includes('NEXUS_LIVE_EDIT_WIDGET'));
  assert.ok(stripped.includes('<h1>Hi</h1>'));
});
