import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachmentManifest,
  attachmentMessageContent,
  embedRoomAttachments,
  parseRoomAttachments,
} from '../lib/roomAttachments.js';

const tinyPng = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]).toString('base64');
const image = { name:'logo.png', mediaType:'image/png', data:tinyPng };

test('valid Room images become bounded multimodal message blocks', () => {
  const parsed = parseRoomAttachments([image]);
  const content = attachmentMessageContent('Use this logo', parsed);
  assert.equal(parsed[0].token, 'NEXUS_IMAGE_1');
  assert.match(attachmentManifest(parsed), /NEXUS_IMAGE_1: logo\.png/);
  assert.equal(content[0].type, 'text');
  assert.equal(content[1].type, 'image');
  assert.equal(content[1].source.media_type, 'image/png');
});

test('image placeholders are embedded after generation for portable exports', () => {
  const parsed = parseRoomAttachments([image]);
  const html = embedRoomAttachments('<img src="NEXUS_IMAGE_1"><p>NEXUS_IMAGE_1</p>', parsed);
  assert.equal((html.match(/data:image\/png;base64,/g) || []).length, 2);
  assert.doesNotMatch(html, /NEXUS_IMAGE_1/);
});

test('Room image validation rejects spoofed and excessive attachments', () => {
  assert.throws(() => parseRoomAttachments([{...image,mediaType:'image/jpeg'}]), /does not match/);
  assert.throws(() => parseRoomAttachments([image,image,image,image]), /no more than 3/);
  assert.throws(() => parseRoomAttachments([{...image,mediaType:'image/svg+xml'}]), /JPG, PNG, or WebP/);
});
