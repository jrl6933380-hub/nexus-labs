// Ad Maker vocabulary v1 — closed registry + schema v2 validation.
// Spec: docs/ad-vocabulary-v1.md. Pure ESM with no imports, shared by browser and server.
// Additive: legacy 4-scene ads (no specVersion) never pass through this file's validator.

export const VOCABULARY_VERSION = '1.0.0';
export const SPEC_VERSION = 2;

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

const ids = (list) => list.map((x) => x.id);
const entry = (id, label, extra = {}) => ({ id, label, ...extra });

export const LIMITS = {
  headline: 60,
  support: 120,
  cta: 35,
  name: 80,
  brand: 35,
  scenesMin: 2,
  scenesMax: 8,
  totalSecMax: 30,
  sceneSecMin: 1.5,
  sceneSecMax: 15,
  transitionMsMin: 200,
  transitionMsMax: 800,
  configBytesMax: 180000,
  sceneIdPattern: '^[a-z0-9-]{1,40}$',
};

export const TEXT_ANIMS = [
  entry('fade_up', 'Fade up'),
  entry('slide_left', 'Slide in'),
  entry('typewriter', 'Typewriter'),
  entry('word_by_word', 'Word by word'),
  entry('mask_reveal', 'Mask reveal'),
  entry('scale_pop', 'Scale pop'),
  entry('kinetic_stack', 'Kinetic stack'),
];

export const CAMERAS = [
  entry('static', 'Static'),
  entry('push_in', 'Push in'),
  entry('pull_out', 'Pull out'),
  entry('pan_left', 'Pan left'),
  entry('pan_right', 'Pan right'),
  entry('parallax', 'Parallax'),
];

export const EASINGS = [
  entry('linear', 'Linear'),
  entry('smooth', 'Smooth (ease in-out cubic)'),
  entry('snappy', 'Snappy (ease-out expo)'),
  entry('bounce', 'Bounce (ease-out back)'),
];

export const TRANSITIONS = [
  entry('cut', 'Cut'),
  entry('crossfade', 'Crossfade'),
  entry('wipe_left', 'Wipe left'),
  entry('slide_up', 'Slide up'),
  entry('zoom_through', 'Zoom through'),
];

export const BACKGROUNDS = [
  entry('solid', 'Solid'),
  entry('gradient', 'Gradient'),
  entry('grain', 'Grain'),
  entry('grid', 'Grid'),
  entry('orbits', 'Orbits'),
  entry('particles', 'Particles (seeded by scene id)'),
];

// Mood token bundles. System font stacks only (ad CSP forbids web fonts).
// Palettes are intentionally absent until Justin approves a direction per mood.
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", Times, serif';
export const MOODS = [
  entry('bold', 'Bold', { heading: SANS, body: SANS, weight: 800, tracking: -0.01, easing: 'snappy', textAnim: 'kinetic_stack', pacing: 1.1 }),
  entry('warm', 'Warm', { heading: SERIF, body: SANS, weight: 600, tracking: 0, easing: 'smooth', textAnim: 'fade_up', pacing: 0.95 }),
  entry('luxury', 'Luxury', { heading: SERIF, body: SANS, weight: 500, tracking: 0.04, easing: 'smooth', textAnim: 'mask_reveal', pacing: 0.85 }),
  entry('playful', 'Playful', { heading: SANS, body: SANS, weight: 700, tracking: 0, easing: 'bounce', textAnim: 'scale_pop', pacing: 1.15 }),
  entry('clean', 'Clean', { heading: SANS, body: SANS, weight: 600, tracking: 0, easing: 'smooth', textAnim: 'slide_left', pacing: 1 }),
];

// Palettes: named colour sets, selectable by dropdown and filterable by mood/industry tags.
// An explicit project accent/background overrides the palette; the palette never overrides explicit values.
const palette = (id, label, bg, accent, text, muted, moods, industries) => entry(id, label, { colors: { bg, accent, text, muted }, tags: { mood: moods, industry: industries } });
export const PALETTES = [
  palette('midnight-gold', 'Midnight gold', '#0b1220', '#e6c572', '#f5f1e6', '#9aa3b5', ['bold', 'luxury'], ['plumber', 'contractor', 'auto', 'dental']),
  palette('charcoal-red', 'Charcoal red', '#151515', '#ef4444', '#fafafa', '#a3a3a3', ['bold'], ['auto', 'fitness', 'contractor', 'plumber']),
  palette('ocean-blue', 'Ocean blue', '#0a2540', '#38bdf8', '#f0f9ff', '#8fb3d1', ['clean', 'bold'], ['plumber', 'dental', 'retail', 'other']),
  palette('fresh-mint', 'Fresh mint', '#0f2a24', '#5eead4', '#ecfdf5', '#8fbfb3', ['clean', 'playful'], ['dental', 'fitness', 'cafe', 'other']),
  palette('sunset-warm', 'Sunset warm', '#2a1410', '#ff9f5a', '#fff4ea', '#c9a592', ['warm'], ['restaurant', 'cafe', 'retail']),
  palette('forest-brass', 'Forest brass', '#14231a', '#d4a24c', '#f2efe6', '#9db3a3', ['luxury', 'warm'], ['restaurant', 'salon', 'contractor']),
  palette('electric-pop', 'Electric pop', '#1e1b4b', '#fde047', '#ffffff', '#a5a3d6', ['playful', 'bold'], ['cafe', 'fitness', 'retail']),
  palette('clean-light', 'Clean light', '#f7f8fa', '#1d4ed8', '#0f172a', '#52607a', ['clean'], ['dental', 'retail', 'other', 'contractor']),
  palette('cream-ink', 'Cream and ink', '#f6efe3', '#9a3412', '#1c1917', '#5c534b', ['warm', 'luxury'], ['restaurant', 'cafe', 'salon']),
  palette('rose-blush', 'Rose blush', '#fff1f2', '#be123c', '#2a0a12', '#6b3a46', ['playful', 'warm', 'luxury'], ['salon', 'cafe', 'retail']),
];

export const FORMATS = [
  entry('portrait', 'Portrait 9:16 (Reels/TikTok)', { width: 360, height: 640 }),
  entry('square', 'Square 1:1 (feed)', { width: 560, height: 560 }),
  entry('landscape', 'Landscape 16:9 (YouTube)', { width: 800, height: 450 }),
];

export const LENGTHS = [
  entry('6', '6 seconds', { seconds: 6, scenes: 2 }),
  entry('15', '15 seconds', { seconds: 15, scenes: 4 }),
  entry('30', '30 seconds', { seconds: 30, scenes: 6 }),
];

export const TAGS = {
  industry: ['plumber', 'cafe', 'salon', 'restaurant', 'contractor', 'dental', 'fitness', 'retail', 'auto', 'other'],
  goal: ['call', 'book', 'visit', 'buy', 'signup'],
  tone: ids(MOODS),
  hook: ['question', 'stat', 'pain_point', 'offer', 'proof'],
};

// Param field kinds: string{max,required}, enum{values}, number{min,max,integer}, numbers{min,max,maxLen}, boolean, items{min,max,fields}
const str = (max, required = false) => ({ kind: 'string', max, required });
const en = (values, required = false) => ({ kind: 'enum', values, required });
const num = (min, max, required = false, integer = false) => ({ kind: 'number', min, max, required, integer });
const nums = (min, max, maxLen) => ({ kind: 'numbers', min, max, maxLen });
// A reference to an item in the account's image library (lib/adImages.js). The ad stores only the id.
export const IMAGE_ID_PATTERN = '^[a-z0-9-]{3,40}$';
const ref = (required = false, pattern = IMAGE_ID_PATTERN) => ({ kind: 'ref', pattern, required });
// Layer ids (graphic scenes) are short lowercase names so layers can point at a parent.
export const LAYER_ID_PATTERN = '^[a-z0-9-]{1,24}$';

// Graphic scene layers: data-only shapes positioned in percent of the frame. No raw SVG, no code.
export const LAYER_SHAPES = ['rect', 'circle', 'pill', 'arc', 'text', 'image', 'line', 'ring', 'polygon', 'star'];
export const LAYER_COLORS = ['accent', 'text', 'muted', 'bg', 'white', 'black', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'pink'];
export const LAYER_MOTIONS = ['none', 'fade_in', 'slide_up', 'slide_left', 'pop', 'draw', 'drift', 'twinkle', 'pulse', 'spin', 'swing', 'bob', 'shake'];
export const LAYER_ORIGINS = ['center', 'top', 'bottom', 'left', 'right'];
export const KEY_EASINGS = ['linear', 'smooth', 'snappy', 'bounce'];
export const LAYER_REVEALS = ['none', 'chars', 'words'];
export const LAYER_BLENDS = ['normal', 'screen', 'multiply', 'overlay'];
export const IMAGE_FITS = ['cover', 'contain'];
export const LAYER_REACTS = ['beat', 'low', 'mid', 'high', 'level'];
// Audio envelopes: one 0-100 loudness number per sample, `audioRate` samples per second, up to 30s at 60/s.
export const AUDIO_MAX_SAMPLES = 1800;
// Hard cap on how many shapes one graphic scene may expand to (layers x count, plus spawned particles).
export const GRAPHIC_MAX_SHAPES = 200;

export const SCENE_TYPES = [
  entry('hook_text', 'Hook text', {
    purpose: 'Opening line',
    priority: 1,
    params: { headline: str(LIMITS.headline, true), support: str(LIMITS.support), textAnim: en(ids(TEXT_ANIMS)) },
  }),
  entry('stat_counter', 'Stat counter', {
    purpose: 'Animated number. Never invent statistics; unsourced numbers render tagged SAMPLE.',
    params: {
      value: num(-1e9, 1e9, true),
      from: num(-1e9, 1e9),
      prefix: str(4),
      suffix: str(10),
      label: str(40),
      numberFormat: en(['integer', 'decimal', 'percent', 'currency']),
      sourceRef: str(80),
    },
  }),
  entry('testimonial', 'Testimonial', {
    purpose: 'Customer quote. Renders as real only with sourceRef; otherwise tagged SAMPLE.',
    params: { quote: str(140, true), attribution: str(40), sourceRef: str(80) },
  }),
  entry('before_after', 'Before / after', {
    purpose: 'Transformation',
    params: {
      beforeLabel: str(20), afterLabel: str(20), beforeText: str(60), afterText: str(60),
      revealStyle: en(['wipe', 'slide', 'fade']),
    },
  }),
  entry('photo_focus', 'Photo focus', {
    purpose: 'Image with slow motion. Set imageId to an image from the account library (list_nexus_images); fit cover (default) crops it into a framed card, contain shows the whole picture in the card, full fills the entire ad frame edge to edge with the caption over it (use this for a complete generated ad image). Without an image it shows the brand mark.',
    params: { image: en(['photo', 'logo']), imageId: ref(), fit: en(['cover', 'contain', 'full']), caption: str(60) },
  }),
  entry('site_mockup', 'Site mockup', {
    purpose: 'Concept website preview (always labeled concept when concept=true)',
    priority: 2,
    params: {
      siteName: str(30, true), headline: str(65, true), cta: str(25),
      style: en(['light', 'dark']), scroll: { kind: 'boolean' },
    },
  }),
  entry('steps_list', 'Steps list', {
    purpose: '2 to 4 steps',
    params: {
      items: { kind: 'items', min: 2, max: 4, required: true, fields: { title: str(30, true), detail: str(60) } },
      stagger: num(0, 1),
    },
  }),
  entry('graphic', 'Graphic', {
    purpose: 'Code-drawn layers placed in percent of the frame and drawn in order, with motion presets, keyframes, parenting and seeded particles. No raw SVG or custom code. Shapes: rect, circle, pill, ring, polygon, star, line, arc, text, image. x/y are the layer center (a line starts at x/y and ends at x2/y2; an arc is the upper half of a circle with x/y at the middle of its base). w is percent of frame width (circle/ring/polygon/star: size, arc: radius), h percent of frame height. Colors are palette roles or a fixed set; color2 makes a gradient. delay is seconds. TRANSFORMS: rotate (degrees), scale, opacity; origin picks which point of a rect/pill/image sits at x/y and is the pivot (e.g. origin top on a hanging pill makes a limb that swings from its end). KEYFRAMES: keys is a list of {t (seconds after the layer starts), x, y, rotate, scale, opacity, ease}; properties left out of a key hold their last value; ease shapes the move into that key. PARENTING: give a layer an id, and later layers may set parent to that id; a child x/y is then an offset from the parent center and it moves, rotates and scales with the parent. EFFECTS: glow and blur (percent of width). REPEAT: count copies of a layer, each shifted by stepX/stepY/stepRotate/stepDelay (a parent id points at the first copy). SPAWNER: emit particles of the layer over emitSpan seconds, each living life seconds, drifting driftX/driftY percent, random offset up to spread percent, seeded by the scene id so it is identical every render. HITS: scene-level impacts, each {at, shake, flash, freeze (seconds of hit-stop), zoom} for fight and punch moments. TEXT: text up to 90 characters; weight (300-900), spacing (letter spacing, em), caps, maxw (percent of width, wraps lines), reveal chars or words with revealStep seconds between units, stroke color + strokeW outline, shadow. STYLE: shadow (drop shadow for any shape), radius (percent of width, rect and image corners), stroke/strokeW (border on rect, pill, circle and image), fit cover or contain for images, blend (screen, multiply, overlay). LOOP: loop true repeats a layer\'s keyframes. AUDIO AND BEAT: scene bpm (+ beatOffset seconds) gives a beat clock; audioRate with audioLow/audioMid/audioHigh (0-100 loudness per sample, made by scripts/ad-audio-envelope.mjs from a real audio file) gives band envelopes. A layer with react beat, low, mid, high or level moves with that signal: rScale (adds to scale), rStretch (adds to vertical scale, for equalizer bars with origin bottom), rOpacity, rX, rY (percent), rRot (degrees), rGlow (percent of width). Scene beatZoom and beatShake pulse the whole scene on each beat. CAMERA: params.camera is a list of {t (seconds), x, y (focus point, percent, default 50/50), zoom (1 = full frame), rotate (degrees), ease} that pans and zooms the whole scene; layers with fixed true ignore the camera and stay on screen (captions, HUD, logos). Up to 48 layers and at most 200 shapes per scene after repeat and spawner.',
    params: {
      layers: {
        kind: 'items', min: 1, max: 48, required: true,
        fields: {
          shape: en(LAYER_SHAPES, true),
          id: ref(false, LAYER_ID_PATTERN),
          parent: ref(false, LAYER_ID_PATTERN),
          x: num(-100, 200, true),
          y: num(-100, 200, true),
          x2: num(-100, 200),
          y2: num(-100, 200),
          w: num(0, 100),
          h: num(0, 100),
          color: en(LAYER_COLORS),
          color2: en(LAYER_COLORS),
          angle: num(0, 360),
          text: str(90),
          size: num(1, 40),
          weight: num(300, 900, false, true),
          spacing: num(-0.2, 1),
          caps: { kind: 'boolean' },
          maxw: num(5, 100),
          reveal: en(LAYER_REVEALS),
          revealStep: num(0.01, 1),
          stroke: en(LAYER_COLORS),
          strokeW: num(0, 10),
          shadow: num(0, 20),
          radius: num(0, 50),
          fit: en(IMAGE_FITS),
          blend: en(LAYER_BLENDS),
          fixed: { kind: 'boolean' },
          loop: { kind: 'boolean' },
          thickness: num(0.5, 20),
          sides: num(3, 12, false, true),
          rotate: num(-720, 720),
          scale: num(0.05, 8),
          opacity: num(0, 1),
          react: en(LAYER_REACTS),
          rScale: num(-2, 2),
          rStretch: num(-10, 10),
          rOpacity: num(-1, 1),
          rX: num(-50, 50),
          rY: num(-50, 50),
          rRot: num(-180, 180),
          rGlow: num(-20, 20),
          origin: en(LAYER_ORIGINS),
          glow: num(0, 20),
          blur: num(0, 20),
          motion: en(LAYER_MOTIONS),
          delay: num(0, 10),
          keys: {
            kind: 'items', min: 1, max: 32,
            fields: {
              t: num(0, 30, true),
              x: num(-100, 200),
              y: num(-100, 200),
              rotate: num(-720, 720),
              scale: num(0.05, 8),
              opacity: num(0, 1),
              ease: en(KEY_EASINGS),
            },
          },
          count: num(1, 24, false, true),
          stepX: num(-100, 100),
          stepY: num(-100, 100),
          stepRotate: num(-360, 360),
          stepDelay: num(0, 5),
          emit: num(1, 60, false, true),
          emitSpan: num(0.1, 10),
          life: num(0.2, 10),
          driftX: num(-100, 100),
          driftY: num(-100, 100),
          spread: num(0, 100),
          imageId: ref(),
        },
      },
      bpm: num(40, 240),
      beatOffset: num(0, 10),
      beatZoom: num(0, 0.3),
      beatShake: num(0, 5),
      audioRate: num(2, 60),
      audioLow: nums(0, 100, AUDIO_MAX_SAMPLES),
      audioMid: nums(0, 100, AUDIO_MAX_SAMPLES),
      audioHigh: nums(0, 100, AUDIO_MAX_SAMPLES),
      camera: {
        kind: 'items', min: 1, max: 12,
        fields: { t: num(0, 30, true), x: num(-100, 200), y: num(-100, 200), zoom: num(0.3, 6), rotate: num(-45, 45), ease: en(KEY_EASINGS) },
      },
      hits: {
        kind: 'items', min: 1, max: 6,
        fields: { at: num(0, 15, true), shake: num(0, 10), flash: num(0, 1), freeze: num(0, 0.5), zoom: num(0, 0.5) },
      },
    },
    check: 'graphic',
  }),
  entry('end_card', 'End card', {
    purpose: 'Call to action',
    priority: 3,
    params: { cta: str(LIMITS.cta, true), destination: str(65), tagline: str(60) },
  }),
];

export const REGISTRY = deepFreeze({
  vocabularyVersion: VOCABULARY_VERSION,
  specVersion: SPEC_VERSION,
  limits: LIMITS,
  sceneTypes: SCENE_TYPES,
  textAnims: TEXT_ANIMS,
  cameras: CAMERAS,
  easings: EASINGS,
  transitions: TRANSITIONS,
  backgrounds: BACKGROUNDS,
  moods: MOODS,
  palettes: PALETTES,
  formats: FORMATS,
  lengths: LENGTHS,
  tags: TAGS,
});

// Read-only description for dropdowns, agents and the future describe_vocabulary tool.
export const describeVocabulary = () => JSON.parse(JSON.stringify(REGISTRY));

export const isSpecV2 = (raw) => !!raw && typeof raw === 'object' && raw.specVersion === SPEC_VERSION;

const HEX = /^#[0-9a-f]{6}$/i;
const SCENE_ID = new RegExp(LIMITS.sceneIdPattern);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function checkKeys(obj, allowed, path, errors) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${path}.${k}: unknown field`);
}

function checkField(spec, v, path, errors) {
  switch (spec.kind) {
    case 'string': {
      if (typeof v !== 'string') return errors.push(`${path}: must be a string`);
      const t = v.trim();
      if (CONTROL.test(t)) return errors.push(`${path}: contains control characters`);
      if (spec.required && !t) return errors.push(`${path}: required`);
      if ([...t].length > spec.max) return errors.push(`${path}: max ${spec.max} characters`);
      return t;
    }
    case 'ref': {
      if (typeof v !== 'string' || !new RegExp(spec.pattern).test(v)) return errors.push(`${path}: must be an image id from list_nexus_images`);
      return v;
    }
    case 'enum':
      if (typeof v !== 'string' || !spec.values.includes(v)) return errors.push(`${path}: must be one of ${spec.values.join(', ')}`);
      return v;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return errors.push(`${path}: must be a finite number`);
      if (v < spec.min || v > spec.max) return errors.push(`${path}: must be between ${spec.min} and ${spec.max}`);
      if (spec.integer && !Number.isInteger(v)) return errors.push(`${path}: must be an integer`);
      return v;
    case 'numbers': {
      if (!Array.isArray(v)) return errors.push(`${path}: must be an array of numbers`);
      if (v.length > spec.maxLen) return errors.push(`${path}: max ${spec.maxLen} values`);
      if (!v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= spec.min && n <= spec.max)) return errors.push(`${path}: every value must be a number between ${spec.min} and ${spec.max}`);
      return v;
    }
    case 'boolean':
      if (typeof v !== 'boolean') return errors.push(`${path}: must be true or false`);
      return v;
    case 'items': {
      if (!Array.isArray(v)) return errors.push(`${path}: must be an array`);
      if (v.length < spec.min || v.length > spec.max) return errors.push(`${path}: needs ${spec.min} to ${spec.max} items`);
      return v.map((item, i) => {
        if (!plain(item)) { errors.push(`${path}[${i}]: must be an object`); return null; }
        return checkParams(spec.fields, item, `${path}[${i}]`, errors);
      });
    }
    default:
      return errors.push(`${path}: unsupported field kind`);
  }
}

// Cross-field checks that a per-field spec cannot express. Keyed by a scene type's `check` name.
const SCENE_CHECKS = {
  graphic(params, path, errors) {
    const layers = Array.isArray(params.layers) ? params.layers : [];
    const seen = new Set();
    let shapes = 0;
    layers.forEach((L, i) => {
      if (!L || typeof L !== 'object') return;
      const p = `${path}.layers[${i}]`;
      if (L.shape === 'line' && (L.x2 === undefined || L.y2 === undefined)) errors.push(`${p}: a line needs x2 and y2`);
      if (L.id !== undefined) {
        if (seen.has(L.id)) errors.push(`${p}.id: duplicate layer id "${L.id}"`);
        seen.add(L.id);
      }
      if (L.parent !== undefined) {
        const before = layers.slice(0, i).some((e) => e && e.id === L.parent);
        if (!before) errors.push(`${p}.parent: "${L.parent}" must be the id of an earlier layer`);
        if (L.parent === L.id) errors.push(`${p}.parent: a layer cannot be its own parent`);
      }
      shapes += L.emit ? L.emit : (L.count || 1);
    });
    if (shapes > GRAPHIC_MAX_SHAPES) errors.push(`${path}.layers: expands to ${shapes} shapes, max ${GRAPHIC_MAX_SHAPES}`);
  },
};

function checkParams(fields, params, path, errors) {
  const out = {};
  checkKeys(params, Object.keys(fields), path, errors);
  for (const [key, spec] of Object.entries(fields)) {
    if (!has(params, key) || params[key] === undefined) {
      if (spec.required) errors.push(`${path}.${key}: required`);
      continue;
    }
    const v = checkField(spec, params[key], `${path}.${key}`, errors);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

const pickEnum = (list, v, path, errors) => {
  if (typeof v !== 'string' || !ids(list).includes(v)) { errors.push(`${path}: must be one of ${ids(list).join(', ')}`); return undefined; }
  return v;
};

// Strict v2 validator. Returns { ok, errors, value }. Never mutates input. Never used for legacy ads.
export function validateProjectV2(raw) {
  const errors = [];
  if (!plain(raw)) return { ok: false, errors: ['project: must be an object'], value: null };
  if (raw.specVersion !== SPEC_VERSION) errors.push('specVersion: must be 2');
  checkKeys(raw, ['specVersion', 'name', 'brand', 'initial', 'accent', 'background', 'mood', 'palette', 'platform', 'tags', 'concept', 'scenes'], 'project', errors);

  const out = { specVersion: SPEC_VERSION };
  if (has(raw, 'name')) out.name = checkField(str(LIMITS.name, true), raw.name, 'name', errors);
  else errors.push('name: required');
  if (has(raw, 'brand')) out.brand = checkField(str(LIMITS.brand), raw.brand, 'brand', errors);
  if (has(raw, 'initial')) out.initial = checkField(str(2), raw.initial, 'initial', errors);
  for (const k of ['accent', 'background']) {
    if (!has(raw, k)) continue;
    if (typeof raw[k] !== 'string' || !HEX.test(raw[k])) errors.push(`${k}: must be a #rrggbb color`);
    else out[k] = raw[k].toLowerCase();
  }
  if (has(raw, 'mood')) out.mood = pickEnum(MOODS, raw.mood, 'mood', errors);
  else errors.push('mood: required');
  if (has(raw, 'palette')) out.palette = pickEnum(PALETTES, raw.palette, 'palette', errors);

  if (!plain(raw.platform)) errors.push('platform: required object');
  else {
    checkKeys(raw.platform, ['format', 'lengthSec'], 'platform', errors);
    const platform = {};
    platform.format = pickEnum(FORMATS, raw.platform.format, 'platform.format', errors);
    if (has(raw.platform, 'lengthSec')) {
      if (!LENGTHS.some((l) => l.seconds === raw.platform.lengthSec)) errors.push(`platform.lengthSec: must be one of ${LENGTHS.map((l) => l.seconds).join(', ')}`);
      else platform.lengthSec = raw.platform.lengthSec;
    }
    out.platform = platform;
  }

  if (has(raw, 'tags')) {
    if (!plain(raw.tags)) errors.push('tags: must be an object');
    else {
      checkKeys(raw.tags, Object.keys(TAGS), 'tags', errors);
      const tags = {};
      for (const [k, allowed] of Object.entries(TAGS)) {
        if (!has(raw.tags, k)) continue;
        if (!allowed.includes(raw.tags[k])) errors.push(`tags.${k}: must be one of ${allowed.join(', ')}`);
        else tags[k] = raw.tags[k];
      }
      out.tags = tags;
    }
  }
  if (has(raw, 'concept')) {
    if (typeof raw.concept !== 'boolean') errors.push('concept: must be true or false');
    else out.concept = raw.concept;
  }

  if (!Array.isArray(raw.scenes)) errors.push('scenes: required array');
  else {
    if (raw.scenes.length < LIMITS.scenesMin || raw.scenes.length > LIMITS.scenesMax) {
      errors.push(`scenes: needs ${LIMITS.scenesMin} to ${LIMITS.scenesMax} scenes`);
    }
    const seen = new Set();
    let total = 0;
    out.scenes = raw.scenes.slice(0, LIMITS.scenesMax * 2).map((s, i) => {
      const p = `scenes[${i}]`;
      if (!plain(s)) { errors.push(`${p}: must be an object`); return null; }
      checkKeys(s, ['id', 'type', 'duration', 'params', 'camera', 'background', 'transitionOut', 'transitionMs'], p, errors);
      const scene = {};
      if (typeof s.id !== 'string' || !SCENE_ID.test(s.id)) errors.push(`${p}.id: must match ${LIMITS.sceneIdPattern}`);
      else if (seen.has(s.id)) errors.push(`${p}.id: duplicate "${s.id}"`);
      else { seen.add(s.id); scene.id = s.id; }
      const type = SCENE_TYPES.find((t) => t.id === s.type);
      if (!type) errors.push(`${p}.type: must be one of ${ids(SCENE_TYPES).join(', ')}`);
      else scene.type = type.id;
      if (typeof s.duration !== 'number' || !Number.isFinite(s.duration) || s.duration < LIMITS.sceneSecMin || s.duration > LIMITS.sceneSecMax) {
        errors.push(`${p}.duration: must be between ${LIMITS.sceneSecMin} and ${LIMITS.sceneSecMax} seconds`);
      } else { scene.duration = s.duration; total += s.duration; }
      if (!plain(s.params)) { if (type) errors.push(`${p}.params: required object`); }
      else if (type) {
        const before = errors.length;
        scene.params = checkParams(type.params, s.params, `${p}.params`, errors);
        if (type.check && errors.length === before) SCENE_CHECKS[type.check](scene.params, `${p}.params`, errors);
      }
      if (has(s, 'camera')) scene.camera = pickEnum(CAMERAS, s.camera, `${p}.camera`, errors);
      if (has(s, 'background')) scene.background = pickEnum(BACKGROUNDS, s.background, `${p}.background`, errors);
      if (has(s, 'transitionOut')) scene.transitionOut = pickEnum(TRANSITIONS, s.transitionOut, `${p}.transitionOut`, errors);
      if (has(s, 'transitionMs')) {
        const v = s.transitionMs;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < LIMITS.transitionMsMin || v > LIMITS.transitionMsMax) {
          errors.push(`${p}.transitionMs: must be between ${LIMITS.transitionMsMin} and ${LIMITS.transitionMsMax}`);
        } else scene.transitionMs = v;
      }
      return scene;
    });
    if (total > LIMITS.totalSecMax) errors.push(`scenes: total ${total}s exceeds ${LIMITS.totalSecMax}s`);
  }

  if (errors.length) return { ok: false, errors, value: null };
  const bytes = new TextEncoder().encode(JSON.stringify(out)).length;
  if (bytes > LIMITS.configBytesMax) return { ok: false, errors: [`project: ${bytes} bytes exceeds ${LIMITS.configBytesMax}`], value: null };
  return { ok: true, errors: [], value: out };
}

// Total v2 duration in seconds.
export const totalDurationV2 = (p) => p.scenes.reduce((n, s) => n + s.duration, 0);

// Deterministic scene lookup for v2, mirroring legacy frameAt semantics:
// boundary selects the next scene; the final endpoint stays on the last scene at progress 1.
export function frameAtV2(p, ms) {
  const total = totalDurationV2(p);
  const t = Math.min(Math.max(ms / 1000, 0), total);
  let start = 0;
  for (let i = 0; i < p.scenes.length; i++) {
    const end = start + p.scenes[i].duration;
    if (t < end || i === p.scenes.length - 1) {
      const progress = Math.min(Math.max((t - start) / p.scenes[i].duration, 0), 1);
      return { index: i, id: p.scenes[i].id, start, end, progress, time: t, total };
    }
    start = end;
  }
  return null;
}
