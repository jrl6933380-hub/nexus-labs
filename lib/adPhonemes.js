// Text to phonemes for the Ad Machine's code-based voice (lib/adVoice.js). Phonemes are ARPAbet symbols with a stress
// digit on vowels (AY1, AH0), the same notation as the CMU Pronouncing Dictionary, so a full dictionary can be dropped
// in without changing anything else.
//
// Order of lookup for a word:  1. overrides you pass in (names, brand words)  2. the dictionary you pass in
// (CMUdict entries)  3. the small built-in table  4. letter-to-sound rules (a rough fallback, see measureLts).
// Nothing here touches the network or the file system.

export const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);
export const CONSONANTS = new Set(['B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH']);
export const isVowelPhone = (p) => VOWELS.has(p.replace(/\d$/, ''));

const P = (s) => s.split(' ');
// A small table of very common words and the names this product needs. Written in CMUdict style.
export const BUILTIN_PRON = Object.freeze({
  a: P('AH0'), an: P('AE1 N'), and: P('AE1 N D'), the: P('DH AH0'), to: P('T UW1'), of: P('AH1 V'), in: P('IH1 N'), is: P('IH1 Z'),
  it: P('IH1 T'), for: P('F AO1 R'), on: P('AA1 N'), with: P('W IH1 TH'), at: P('AE1 T'), as: P('AE1 Z'), be: P('B IY1'), we: P('W IY1'),
  you: P('Y UW1'), your: P('Y AO1 R'), our: P('AW1 ER0'), my: P('M AY1'), i: P('AY1'), me: P('M IY1'), no: P('N OW1'), yes: P('Y EH1 S'),
  build: P('B IH1 L D'), next: P('N EH1 K S T'), idea: P('AY0 D IY1 AH0'), ideas: P('AY0 D IY1 AH0 Z'), new: P('N UW1'), now: P('N AW1'),
  nexus: P('N EH1 K S AH0 S'), nex: P('N EH1 K S'), pizza: P('P IY1 T S AH0'), hot: P('HH AA1 T'), fresh: P('F R EH1 SH'),
  slice: P('S L AY1 S'), time: P('T AY1 M'), night: P('N AY1 T'), all: P('AO1 L'), make: P('M EY1 K'), made: P('M EY1 D'),
  best: P('B EH1 S T'), free: P('F R IY1'), get: P('G EH1 T'), today: P('T AH0 D EY1'), call: P('K AO1 L'), here: P('HH IY1 R'),
  love: P('L AH1 V'), great: P('G R EY1 T'), good: P('G UH1 D'), one: P('W AH1 N'), two: P('T UW1'), three: P('TH R IY1'),
  that: P('DH AE1 T'), this: P('DH IH1 S'), from: P('F R AH1 M'), up: P('AH1 P'), down: P('D AW1 N'), out: P('AW1 T'),
  town: P('T AW1 N'), crew: P('K R UW1'), cheese: P('CH IY1 Z'), crust: P('K R AH1 S T'), sauce: P('S AO1 S'), golden: P('G OW1 L D AH0 N'),
});

// ---- letter-to-sound rules: [left context, letters, right context, phones]. Contexts are written with
// # (one or more vowels), : (zero or more consonants), ^ (one consonant), % (e, es, ed, er, ely, ing at the end).
const RULE_CLASSES = {'#': '[aeiouy]+', ':': '[^aeiouy]*', '^': '[^aeiouy]', '%': '(?:e|es|ed|er|ely|ing)$', '$': '$'};
const compile = (ctx, side) => {
  let src = '';
  for (const ch of ctx) src += RULE_CLASSES[ch] ?? ch;
  return new RegExp(side === 'left' ? `${src}$` : `^${src}`);
};
const RULES_RAW = {
  a: [['', 'a', '^#', 'EY1'], ['', 'ai', '', 'EY1'], ['', 'ay', '', 'EY1'], ['', 'au', '', 'AO1'], ['', 'aw', '', 'AO1'], ['', 'a', '^e$', 'EY1'], ['', 'a', 'll', 'AO1'], ['', 'a', 'r', 'AA1'], ['', 'a', '', 'AE1']],
  b: [['', 'b', '', 'B']],
  c: [['', 'ch', '', 'CH'], ['', 'ck', '', 'K'], ['', 'c', '[eiy]', 'S'], ['', 'c', '', 'K']],
  d: [['', 'd', '', 'D']],
  e: [['[^aeiouy]', 'e', '$', ''], ['', 'ee', '', 'IY1'], ['', 'ea', '', 'IY1'], ['', 'ew', '', 'UW1'], ['', 'ey', '', 'IY1'], ['', 'er', '$', 'ER0'], ['', 'er', '', 'ER1'], ['', 'e', '^e$', 'IY1'], ['', 'e', '', 'EH1']],
  f: [['', 'ff', '', 'F'], ['', 'f', '', 'F']],
  g: [['', 'gh', '', ''], ['', 'ng', '', 'NG'], ['', 'g', '[eiy]', 'JH'], ['', 'g', '', 'G']],
  h: [['', 'h', '', 'HH']],
  i: [['', 'igh', '', 'AY1'], ['', 'ir', '', 'ER1'], ['', 'ie', '', 'IY1'], ['', 'i', '^e$', 'AY1'], ['', 'i', '^#', 'AY1'], ['', 'i', '', 'IH1']],
  j: [['', 'j', '', 'JH']],
  k: [['^', 'kn', '', 'N'], ['', 'k', '', 'K']],
  l: [['', 'll', '', 'L'], ['', 'l', '', 'L']],
  m: [['', 'mm', '', 'M'], ['', 'm', '', 'M']],
  n: [['', 'nn', '', 'N'], ['', 'n', '', 'N']],
  o: [['', 'oo', '', 'UW1'], ['', 'oa', '', 'OW1'], ['', 'ow', '$', 'OW1'], ['', 'ow', '', 'AW1'], ['', 'ou', '', 'AW1'], ['', 'oi', '', 'OY1'], ['', 'oy', '', 'OY1'], ['', 'or', '', 'AO1'], ['', 'o', '^e$', 'OW1'], ['', 'o', '', 'AA1']],
  p: [['', 'ph', '', 'F'], ['', 'pp', '', 'P'], ['', 'p', '', 'P']],
  q: [['', 'qu', '', 'K W'], ['', 'q', '', 'K']],
  r: [['', 'rr', '', 'R'], ['', 'r', '', 'R']],
  s: [['', 'sh', '', 'SH'], ['', 'ss', '', 'S'], ['#', 's', '$', 'Z'], ['', 's', '', 'S']],
  t: [['', 'tch', '', 'CH'], ['', 'th', '', 'TH'], ['', 'tion', '', 'SH AH0 N'], ['', 'tt', '', 'T'], ['', 't', '', 'T']],
  u: [['', 'ur', '', 'ER1'], ['', 'u', '^e$', 'UW1'], ['', 'u', '', 'AH1']],
  v: [['', 'v', '', 'V']],
  w: [['', 'wh', '', 'W'], ['', 'wr', '', 'R'], ['', 'w', '', 'W']],
  x: [['', 'x', '', 'K S']],
  y: [['^', 'y', '$', 'AY1'], ['#', 'y', '$', 'IY0'], ['', 'y', '', 'Y']],
  z: [['', 'zz', '', 'Z'], ['', 'z', '', 'Z']],
};
const RULES = {};
for (const [letter, list] of Object.entries(RULES_RAW)) RULES[letter] = list.map(([l, g, r, out]) => ({left: compile(l, 'left'), g, right: compile(r, 'right'), out: out ? out.split(' ') : []}));

/** Letter-to-sound fallback. Returns ARPAbet with stress digits; a rough guess for words not in a dictionary. */
export function letterToSound(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  const out = [];
  let i = 0;
  while (i < w.length) {
    const rules = RULES[w[i]];
    if (!rules) { i++; continue; }
    const rule = rules.find((r) => w.startsWith(r.g, i) && r.left.test(w.slice(0, i)) && r.right.test(w.slice(i + r.g.length)));
    if (!rule) { i++; continue; }
    out.push(...rule.out);
    i += rule.g.length;
  }
  // Stress: one primary stress, others reduced. Monosyllables get it on the vowel; longer words on the first
  // syllable, or the second after a common unstressed prefix.
  const vowelAt = out.map((p, k) => (isVowelPhone(p) ? k : -1)).filter((k) => k >= 0);
  if (!vowelAt.length) { out.push('AH1'); return out; }
  const prefixed = vowelAt.length > 2 && /^(a|be|de|re|in|ex|con|pro|dis|im|en)[^aeiouy]/.test(w);
  const stressIdx = prefixed ? vowelAt[1] : vowelAt[0];
  for (const k of vowelAt) {
    const base = out[k].replace(/\d$/, '');
    out[k] = base + (k === stressIdx ? '1' : '0');
  }
  return out;
}

/**
 * Words to phonemes. `dictionary` and `overrides` map a lowercase word to either a phoneme array or a CMUdict-style
 * string ("B IH1 L D"). Returns [{word, phones, source}] with source one of override, dictionary, builtin, rules.
 */
export function phonemize(text, {dictionary = null, overrides = null} = {}) {
  const asList = (v) => (Array.isArray(v) ? v : String(v).trim().split(/\s+/));
  const words = String(text).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  return words.map((word) => {
    if (overrides && overrides[word]) return {word, phones: asList(overrides[word]), source: 'override'};
    if (dictionary && dictionary[word]) return {word, phones: asList(dictionary[word]), source: 'dictionary'};
    if (BUILTIN_PRON[word]) return {word, phones: [...BUILTIN_PRON[word]], source: 'builtin'};
    return {word, phones: letterToSound(word.replace(/'/g, '')), source: 'rules'};
  });
}

const ONSETS = new Set(['P R', 'P L', 'B R', 'B L', 'T R', 'D R', 'K R', 'G R', 'K L', 'G L', 'F R', 'F L', 'S P', 'S T', 'S K', 'S L', 'S M', 'S N', 'S W', 'TH R', 'SH R', 'T W', 'K W', 'S P R', 'S T R', 'S K R', 'HH Y', 'P Y', 'B Y', 'K Y']);
/** Split one word's phones into syllables: [{onset:[...], nucleus:'AY1', coda:[...]}]. */
export function syllabify(phones) {
  const nuclei = phones.map((p, i) => (isVowelPhone(p) ? i : -1)).filter((i) => i >= 0);
  if (!nuclei.length) return [{onset: [], nucleus: null, coda: [...phones]}];
  const sylls = nuclei.map((idx) => ({onset: [], nucleus: phones[idx], coda: [], idx}));
  for (let n = 0; n < nuclei.length; n++) {
    const from = nuclei[n] + 1, to = n + 1 < nuclei.length ? nuclei[n + 1] : phones.length;
    const between = phones.slice(from, to);
    if (n + 1 === nuclei.length) { sylls[n].coda = between; continue; }
    // Give the next syllable the longest valid onset (maximal onset), the rest closes this one.
    let take = Math.min(between.length, 3);
    while (take > 1 && !ONSETS.has(between.slice(between.length - take).join(' '))) take--;
    if (between.length === 0) take = 0;
    sylls[n].coda = between.slice(0, between.length - take);
    sylls[n + 1].onset = between.slice(between.length - take);
  }
  sylls[0].onset = phones.slice(0, nuclei[0]);
  return sylls;
}

/** Phoneme error rate of the letter-to-sound rules against a dictionary (Levenshtein over stress-free phones). */
export function measureLts(dictionary, {limit = 5000, minLen = 3} = {}) {
  const strip = (arr) => arr.map((p) => p.replace(/\d$/, ''));
  const lev = (a, b) => {
    const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let words = 0, exact = 0, edits = 0, total = 0;
  for (const [w, pron] of Object.entries(dictionary)) {
    if (words >= limit) break;
    if (w.length < minLen || !/^[a-z]+$/.test(w)) continue;
    const ref = strip(Array.isArray(pron) ? pron : pron.split(/\s+/)), hyp = strip(letterToSound(w));
    const e = lev(hyp, ref);
    words++; total += ref.length; edits += e; if (e === 0) exact++;
  }
  return {words, wordAccuracy: exact / words, phonemeErrorRate: edits / total};
}
