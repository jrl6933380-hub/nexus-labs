// Dependency-free live scene runtime shared by Story Studio's browser and
// server. Nex directs bounded character actors; this module makes those
// directions deterministic, persistent, and safe to render at any time.

export const STORY_SCENE_VERSION = 1;
export const DEFAULT_SCENE_DURATION_MS = 6_000;
export const MAX_SCENE_DURATION_MS = 120_000;

const MAX_ACTORS = 8;
const MAX_KEYFRAMES = 64;
const MAX_DIRECTIONS = 48;

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

export function actorId(value, fallback = 'actor') {
  const normalized = cleanText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeDuration(value) {
  return Math.round(clamp(number(value, DEFAULT_SCENE_DURATION_MS), 1_000, MAX_SCENE_DURATION_MS));
}

function normalizeEasing(value, fallback = 'ease-in-out') {
  return ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'].includes(value) ? value : fallback;
}

function defaultActorFrame(index = 0) {
  return {
    atMs: 0,
    x: index % 2 ? 72 : 28,
    y: 66,
    scale: 1,
    rotation: 0,
    opacity: 1,
    z: index + 1,
    pose: 'story-ready',
    expression: 'focused',
    facing: index % 2 ? 'left' : 'right',
    easing: 'ease-in-out',
  };
}

function normalizeActorFrame(value, fallback, durationMs) {
  return {
    atMs: Math.round(clamp(number(value?.atMs, fallback.atMs), 0, durationMs)),
    // These are stage coordinates, not composition limits. Off-stage values
    // let Nex direct entrances and exits without losing the actor state.
    x: round(clamp(number(value?.x, fallback.x), -200, 300)),
    y: round(clamp(number(value?.y, fallback.y), -200, 300)),
    scale: round(clamp(number(value?.scale, fallback.scale), 0.05, 5)),
    rotation: round(clamp(number(value?.rotation, fallback.rotation), -720, 720)),
    opacity: round(clamp(number(value?.opacity, fallback.opacity), 0, 1)),
    z: Math.round(clamp(number(value?.z, fallback.z), -100, 100)),
    pose: cleanText(value?.pose ?? fallback.pose, 100) || 'story-ready',
    expression: cleanText(value?.expression ?? fallback.expression, 100) || 'focused',
    facing: ['left', 'right', 'camera', 'away'].includes(value?.facing) ? value.facing : fallback.facing,
    easing: normalizeEasing(value?.easing, fallback.easing),
  };
}

function normalizeBounds(value, fallback = {}) {
  const width = round(clamp(number(value?.width, fallback.width ?? 20), 1, 200));
  const height = round(clamp(number(value?.height, fallback.height ?? 45), 1, 200));
  return {
    x: round(clamp(number(value?.x, fallback.x ?? 40), -200, 300)),
    y: round(clamp(number(value?.y, fallback.y ?? 35), -200, 300)),
    width,
    height,
  };
}

function normalizeAnchor(value, fallback = {}) {
  return {
    x: round(clamp(number(value?.x, fallback.x ?? 50), -200, 300)),
    y: round(clamp(number(value?.y, fallback.y ?? 30), -200, 300)),
  };
}

function normalizeActor(value, index, durationMs, character = {}) {
  const id = actorId(value?.id || value?.actorId || character.actorId || character.name, `actor-${index + 1}`);
  const fallback = defaultActorFrame(index);
  const sourceFrames = Array.isArray(value?.keyframes) && value.keyframes.length
    ? value.keyframes
    : [{ ...fallback, ...(value?.blocking || {}) }];
  const keyframes = sourceFrames
    .map((frame) => normalizeActorFrame(frame, fallback, durationMs))
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, MAX_KEYFRAMES);
  const poster = keyframes[0] || fallback;
  const bounds = normalizeBounds(value?.bounds, {
    x: poster.x - 10,
    y: poster.y - 35,
    width: 20,
    height: 45,
  });
  return {
    id,
    name: cleanText(value?.name || character.name || id, 80),
    characterId: actorId(value?.characterId || character.actorId || character.name || id, id),
    role: cleanText(value?.role || character.role, 120),
    assetUrl: /^\/api\/story-actor\?[a-zA-Z0-9_%=&.-]+$/u.test(cleanText(value?.assetUrl, 500))
      ? cleanText(value.assetUrl, 500)
      : null,
    bounds,
    faceAnchor: normalizeAnchor(value?.faceAnchor, { x:poster.x, y:poster.y - 28 }),
    speechAnchor: normalizeAnchor(value?.speechAnchor, { x:poster.x, y:poster.y - 34 }),
    keyframes,
  };
}

function normalizeCameraFrame(value, fallback, durationMs) {
  return {
    atMs: Math.round(clamp(number(value?.atMs, fallback.atMs), 0, durationMs)),
    x: round(clamp(number(value?.x, fallback.x), -100, 200)),
    y: round(clamp(number(value?.y, fallback.y), -100, 200)),
    zoom: round(clamp(number(value?.zoom, fallback.zoom), 0.5, 4)),
    rotation: round(clamp(number(value?.rotation, fallback.rotation), -45, 45)),
    easing: normalizeEasing(value?.easing, fallback.easing),
  };
}

function characterForActor(characters, input) {
  const wanted = actorId(input?.characterId || input?.actorId || input?.id || input?.name, '');
  return characters.find((character) => actorId(character?.actorId || character?.name, '') === wanted) || {};
}

function inferredActors(characters, dialogue) {
  const speakers = new Set((Array.isArray(dialogue) ? dialogue : []).map((line) => actorId(line?.actorId || line?.speaker, '')).filter(Boolean));
  const selected = (Array.isArray(characters) ? characters : []).filter((character) => speakers.has(actorId(character?.actorId || character?.name, '')));
  const source = selected.length ? selected : (Array.isArray(characters) ? characters.slice(0, 2) : []);
  return source.map((character, index) => ({
    id: actorId(character?.actorId || character?.name, `actor-${index + 1}`),
    name: character?.name,
    characterId: actorId(character?.actorId || character?.name, `actor-${index + 1}`),
  }));
}

export function normalizeStoryScene(value, options = {}) {
  const durationMs = normalizeDuration(value?.durationMs ?? options.durationMs);
  const characters = Array.isArray(options.characters) ? options.characters : [];
  const dialogue = Array.isArray(options.dialogue) ? options.dialogue : [];
  const sourceActors = Array.isArray(value?.actors) && value.actors.length
    ? value.actors
    : inferredActors(characters, dialogue);
  const actors = sourceActors.slice(0, MAX_ACTORS).map((entry, index) => (
    normalizeActor(entry, index, durationMs, characterForActor(characters, entry))
  ));
  const cameraFallback = { atMs:0, x:50, y:50, zoom:1, rotation:0, easing:'ease-in-out' };
  const cameraFrames = (Array.isArray(value?.camera?.keyframes) && value.camera.keyframes.length
    ? value.camera.keyframes
    : [cameraFallback])
    .map((frame) => normalizeCameraFrame(frame, cameraFallback, durationMs))
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, MAX_KEYFRAMES);
  const directions = (Array.isArray(value?.directions) ? value.directions : [])
    .map((entry) => ({
      atMs: Math.round(clamp(number(entry?.atMs, 0), 0, durationMs)),
      actorId: actorId(entry?.actorId, ''),
      direction: cleanText(entry?.direction, 500),
      deliveredBy: 'nex',
      deliveredAt: Math.max(0, Math.round(number(entry?.deliveredAt, 0))),
    }))
    .filter((entry) => entry.actorId && entry.direction)
    .slice(-MAX_DIRECTIONS);
  return {
    version: STORY_SCENE_VERSION,
    durationMs,
    posterTimeMs: Math.round(clamp(number(value?.posterTimeMs, options.posterTimeMs ?? 0), 0, durationMs)),
    revision: Math.max(0, Math.round(number(value?.revision, 0))),
    directedBy: 'nex',
    stage: {
      aspectRatio: '16:9',
      backgroundMode: 'layered-composite',
    },
    camera: { keyframes:cameraFrames },
    actors,
    directions,
    updatedAt: Math.max(0, Math.round(number(value?.updatedAt, 0))),
  };
}

function ease(progress, name) {
  if (name === 'step') return progress < 1 ? 0 : 1;
  if (name === 'ease-in') return progress * progress;
  if (name === 'ease-out') return 1 - (1 - progress) * (1 - progress);
  if (name === 'ease-in-out') return progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
  return progress;
}

function sampleFrames(frames, timeMs, numericFields, textFields = []) {
  if (!frames.length) return null;
  if (timeMs <= frames[0].atMs) return { ...frames[0] };
  if (timeMs >= frames[frames.length - 1].atMs) return { ...frames[frames.length - 1] };
  const nextIndex = frames.findIndex((frame) => frame.atMs >= timeMs);
  const before = frames[nextIndex - 1];
  const after = frames[nextIndex];
  const progress = ease((timeMs - before.atMs) / Math.max(1, after.atMs - before.atMs), after.easing);
  const sampled = { atMs:timeMs, easing:after.easing };
  numericFields.forEach((field) => { sampled[field] = round(before[field] + (after[field] - before[field]) * progress); });
  textFields.forEach((field) => { sampled[field] = progress < 0.5 ? before[field] : after[field]; });
  return sampled;
}

export function sampleStoryScene(value, timeMs = null, options = {}) {
  const scene = normalizeStoryScene(value, options);
  const atMs = timeMs === null || timeMs === undefined
    ? scene.posterTimeMs
    : clamp(number(timeMs, scene.posterTimeMs), 0, scene.durationMs);
  return {
    ...scene,
    atMs,
    camera: sampleFrames(scene.camera.keyframes, atMs, ['x', 'y', 'zoom', 'rotation']),
    actors: scene.actors.map((actor) => ({
      ...actor,
      frame: sampleFrames(
        actor.keyframes,
        atMs,
        ['x', 'y', 'scale', 'rotation', 'opacity', 'z'],
        ['pose', 'expression', 'facing'],
      ),
    })),
  };
}

function upsertFrame(frames, atMs, changes, normalize, durationMs) {
  const sampled = sampleFrames(
    frames,
    atMs,
    normalize === normalizeActorFrame
      ? ['x', 'y', 'scale', 'rotation', 'opacity', 'z']
      : ['x', 'y', 'zoom', 'rotation'],
    normalize === normalizeActorFrame ? ['pose', 'expression', 'facing'] : [],
  ) || frames[0];
  const next = normalize({ ...sampled, ...changes, atMs }, sampled, durationMs);
  return [...frames.filter((frame) => frame.atMs !== next.atMs), next]
    .sort((a, b) => a.atMs - b.atMs)
    .slice(-MAX_KEYFRAMES);
}

export function applyNexSceneOperations(value, operations = [], options = {}) {
  const scene = normalizeStoryScene(value, options);
  const items = Array.isArray(operations) ? operations.slice(0, 96) : [];
  for (const operation of items) {
    const type = cleanText(operation?.type, 40);
    if (type === 'set-duration') {
      scene.durationMs = normalizeDuration(operation.durationMs);
      continue;
    }
    if (type === 'set-poster-time') {
      scene.posterTimeMs = Math.round(clamp(number(operation.atMs, 0), 0, scene.durationMs));
      continue;
    }
    if (type === 'camera') {
      scene.camera.keyframes = upsertFrame(scene.camera.keyframes, Math.round(number(operation.atMs, 0)), operation, normalizeCameraFrame, scene.durationMs);
      continue;
    }
    const id = actorId(operation?.actorId, '');
    const actor = scene.actors.find((candidate) => candidate.id === id || candidate.characterId === id);
    if (!actor) continue;
    const atMs = Math.round(clamp(number(operation.atMs, 0), 0, scene.durationMs));
    if (type === 'move') {
      actor.keyframes = upsertFrame(actor.keyframes, atMs, operation, normalizeActorFrame, scene.durationMs);
    } else if (type === 'enter' || type === 'exit') {
      actor.keyframes = upsertFrame(actor.keyframes, atMs, {
        ...operation,
        opacity:type === 'enter' ? 1 : 0,
      }, normalizeActorFrame, scene.durationMs);
    } else if (type === 'pose') {
      actor.keyframes = upsertFrame(actor.keyframes, atMs, {pose:operation.pose}, normalizeActorFrame, scene.durationMs);
    } else if (type === 'emote') {
      actor.keyframes = upsertFrame(actor.keyframes, atMs, {expression:operation.expression}, normalizeActorFrame, scene.durationMs);
    } else if (type === 'face') {
      actor.keyframes = upsertFrame(actor.keyframes, atMs, {facing:operation.facing}, normalizeActorFrame, scene.durationMs);
    } else if (type === 'set-speech-anchor') {
      actor.speechAnchor = normalizeAnchor(operation, actor.speechAnchor);
    } else if (type === 'set-bounds') {
      actor.bounds = normalizeBounds(operation, actor.bounds);
      actor.faceAnchor = normalizeAnchor(operation.faceAnchor, actor.faceAnchor);
    } else if (type === 'record-direction') {
      const direction = cleanText(operation.direction, 500);
      if (direction) scene.directions.push({
        atMs,
        actorId:actor.id,
        direction,
        deliveredBy:'nex',
        deliveredAt:Math.max(0, Math.round(number(options.now, Date.now()))),
      });
    }
  }
  return normalizeStoryScene({
    ...scene,
    revision:scene.revision + 1,
    updatedAt:Math.max(0, Math.round(number(options.now, Date.now()))),
    directions:scene.directions.slice(-MAX_DIRECTIONS),
  }, options);
}

export const __internals = { MAX_ACTORS, MAX_DIRECTIONS, MAX_KEYFRAMES, defaultActorFrame };
