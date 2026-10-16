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
  return current.replace(VOCAB_LINE, () => vocabLine());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL(PLAYER_PATH, root), buildAdPlayer());
  console.log('updated', PLAYER_PATH);
}
