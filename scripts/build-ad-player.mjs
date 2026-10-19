// Keeps the player's embedded tokens (moods, palettes, formats, version) identical to the
// vocabulary registry. The player file is the source of truth for rendering code; only its
// `const VOCAB=...;` line is generated.
// Run: node scripts/build-ad-player.mjs   (a test fails if the committed file is out of date)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGISTRY } from '../public/ad-vocabulary.mjs';

export const PLAYER_PATH = 'public/ad-designs/vocabulary-player.html';
const root = new URL('../', import.meta.url);
const VOCAB_LINE = /^const VOCAB=.*;$/m;
const KEY_BLOCK = /\/\*KEY-BEGIN\*\/[\s\S]*?\/\*KEY-END\*\//;
const SEL_BLOCK = /\/\*SEL-BEGIN\*\/[\s\S]*?\/\*SEL-END\*\//;
const WORLD_BLOCK = /\/\*WORLD3D-BEGIN\*\/[\s\S]*?\/\*WORLD3D-END\*\//;

export function worldBlock() {
  const src = readFileSync(new URL('public/ad-world3d.mjs', root), 'utf8').replace(/^export /gm, '').replace(/^\/\/.*$/gm, '').replace(/\n{2,}/g, '\n').trim();
  return `/*WORLD3D-BEGIN*/${src}/*WORLD3D-END*/`;
}

// The keyer is written once (public/ad-key.mjs) and embedded here, so the player and the tests run the same code.
export function selBlock() {
  const src = readFileSync(new URL('public/ad-select.mjs', root), 'utf8').replace(/^export /gm, '').replace(/^\/\/.*$/gm, '').replace(/\n{2,}/g, '\n').trim();
  return `/*SEL-BEGIN*/${src}/*SEL-END*/`;
}
export function keyBlock() {
  const src = readFileSync(new URL('public/ad-key.mjs', root), 'utf8').replace(/^export /gm, '').replace(/^\/\/.*$/gm, '').replace(/\n{2,}/g, '\n').trim();
  return `/*KEY-BEGIN*/${src}/*KEY-END*/`;
}

export function vocabLine() {
  const vocab = {
    vocabularyVersion: REGISTRY.vocabularyVersion,
    formats: REGISTRY.formats,
    moods: REGISTRY.moods,
    palettes: REGISTRY.palettes,
    easings: REGISTRY.easings,
  };
  // "<" inside JSON must not be able to close the script element.
  return `const VOCAB=${JSON.stringify(vocab).replace(/</g, '\\u003c')};`;
}

export function buildAdPlayer(current = readFileSync(new URL(PLAYER_PATH, root), 'utf8')) {
  if (!VOCAB_LINE.test(current)) throw new Error('player is missing its "const VOCAB=...;" line');
  if (!KEY_BLOCK.test(current)) throw new Error('player is missing its KEY block');
  if (!SEL_BLOCK.test(current)) throw new Error('player is missing its SEL block');
  if (!WORLD_BLOCK.test(current)) throw new Error('player is missing its WORLD3D block');
  return current.replace(VOCAB_LINE, () => vocabLine()).replace(KEY_BLOCK, () => keyBlock()).replace(SEL_BLOCK, () => selBlock()).replace(WORLD_BLOCK, () => worldBlock());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL(PLAYER_PATH, root), buildAdPlayer());
  console.log('updated', PLAYER_PATH);
}
