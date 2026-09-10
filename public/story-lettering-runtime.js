// Shared, dependency-free lettering timeline used by Story Studio in both the
// browser and server. Customers never edit this directly; Nex owns the tracks.

export const LETTERING_TIMELINE_VERSION = 1;
export const DEFAULT_PANEL_DURATION_MS = 6_000;
export const MAX_PANEL_DURATION_MS = 120_000;
const MAX_TRACKS = 8;
const MAX_TEXT_CUES = 32;
const MAX_KEYFRAMES = 48;

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
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

function trackId(value, index) {
  const cleaned = cleanText(value, 80).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  return cleaned || `bubble-${index + 1}`;
}

function actorId(value) {
  return cleanText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
}

function defaultLayout(line = {}, index = 0) {
  const length = cleanText(line.line, 500).length;
  const width = length <= 20 ? 23 : length <= 42 ? 30 : length <= 70 ? 35 : 40;
  const side = line.side === 'right' ? 'right' : 'left';
  return {
    x: side === 'right' ? 96 - width : 4,
    y: 10 + index * 24,
    width,
    opacity: 1,
    scale: 1,
    tailX: side === 'right' ? 82 : 18,
    tailY: 45,
    easing: 'ease-in-out',
  };
}

function normalizeDuration(value) {
  return Math.round(clamp(number(value, DEFAULT_PANEL_DURATION_MS), 1_000, MAX_PANEL_DURATION_MS));
}

function normalizeTextCue(value, fallbackText, durationMs) {
  const startMs = Math.round(clamp(number(value?.startMs, 0), 0, Math.max(0, durationMs - 1)));
  const endMs = Math.round(clamp(number(value?.endMs, durationMs), startMs + 1, durationMs));
  return {
    startMs,
    endMs,
    text: cleanText(value?.text ?? fallbackText, 500),
  };
}

function normalizeKeyframe(value, fallback, durationMs) {
  const easing = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'].includes(value?.easing)
    ? value.easing
    : fallback.easing;
  return {
    atMs: Math.round(clamp(number(value?.atMs, 0), 0, durationMs)),
    // Nex may stage bubbles beyond the frame for entrances and exits. These
    // are abuse/sanity bounds, not composition zones.
    x: round(clamp(number(value?.x, fallback.x), -200, 300)),
    y: round(clamp(number(value?.y, fallback.y), -200, 300)),
    width: round(clamp(number(value?.width, fallback.width), 4, 160)),
    opacity: round(clamp(number(value?.opacity, fallback.opacity), 0, 1)),
    scale: round(clamp(number(value?.scale, fallback.scale), 0.05, 5)),
    tailX: round(clamp(number(value?.tailX, fallback.tailX), -200, 300)),
    tailY: round(clamp(number(value?.tailY, fallback.tailY), -200, 300)),
    easing,
  };
}

function normalizeTrack(value, fallbackLine, index, durationMs) {
  const line = fallbackLine || {};
  const base = {
    ...defaultLayout(line, index),
    ...(line.layout && typeof line.layout === 'object' ? line.layout : {}),
  };
  const cueFallback = cleanText(line.line, 500);
  const sourceCues = Array.isArray(value?.textCues) && value.textCues.length
    ? value.textCues
    : [{ startMs:number(line.startMs, 0), endMs:number(line.endMs, durationMs), text:cueFallback }];
  const textCues = sourceCues
    .map((cue) => normalizeTextCue(cue, cueFallback, durationMs))
    .filter((cue) => cue.text)
    .slice(0, MAX_TEXT_CUES)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const sourceFrames = Array.isArray(value?.keyframes) && value.keyframes.length
    ? value.keyframes
    : [{ atMs:0, ...base }];
  const keyframes = sourceFrames
    .map((frame) => normalizeKeyframe(frame, base, durationMs))
    .slice(0, MAX_KEYFRAMES)
    .sort((a, b) => a.atMs - b.atMs);
  return {
    id: trackId(value?.id, index),
    actorId: actorId(value?.actorId ?? line.actorId ?? line.speaker),
    followsActor: value?.followsActor === true,
    actorOffsetX: round(clamp(number(value?.actorOffsetX, 0), -300, 300)),
    actorOffsetY: round(clamp(number(value?.actorOffsetY, -22), -300, 300)),
    speaker: cleanText(value?.speaker ?? line.speaker, 80),
    type: ['speech', 'thought', 'shout'].includes(value?.type ?? line.type) ? (value?.type ?? line.type) : 'speech',
    side: (value?.side ?? line.side) === 'right' ? 'right' : 'left',
    textCues,
    keyframes,
  };
}

export function normalizeLetteringTimeline(value, dialogue = [], options = {}) {
  const durationMs = normalizeDuration(value?.durationMs ?? options.durationMs);
  const sourceTracks = Array.isArray(value?.tracks) ? value.tracks : [];
  const lines = Array.isArray(dialogue) ? dialogue.filter((line) => line?.line) : [];
  const count = Math.min(MAX_TRACKS, Math.max(sourceTracks.length, lines.length));
  const tracks = [];
  const usedIds = new Set();
  for (let index = 0; index < count; index += 1) {
    const track = normalizeTrack(sourceTracks[index], lines[index], index, durationMs);
    let id = track.id;
    let suffix = 2;
    while (usedIds.has(id)) id = `${track.id}-${suffix++}`;
    usedIds.add(id);
    tracks.push({ ...track, id });
  }
  return {
    version: LETTERING_TIMELINE_VERSION,
    durationMs,
    posterTimeMs: Math.round(clamp(number(value?.posterTimeMs, options.posterTimeMs ?? 0), 0, durationMs)),
    revision: Math.max(0, Math.round(number(value?.revision, 0))),
    directedBy: 'nex',
    updatedAt: Math.max(0, Math.round(number(value?.updatedAt, 0))),
    tracks,
  };
}

function ease(progress, name) {
  if (name === 'step') return progress < 1 ? 0 : 1;
  if (name === 'ease-in') return progress * progress;
  if (name === 'ease-out') return 1 - (1 - progress) * (1 - progress);
  if (name === 'ease-in-out') return progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
  return progress;
}

function sampleText(track, timeMs) {
  const active = track.textCues
    .filter((cue) => timeMs >= cue.startMs && timeMs < cue.endMs)
    .sort((a, b) => b.startMs - a.startMs)[0];
  return active?.text || '';
}

function sampleFrame(track, timeMs) {
  const frames = track.keyframes;
  if (!frames.length) return defaultLayout({}, 0);
  if (timeMs <= frames[0].atMs) return frames[0];
  if (timeMs >= frames[frames.length - 1].atMs) return frames[frames.length - 1];
  const nextIndex = frames.findIndex((frame) => frame.atMs >= timeMs);
  const before = frames[nextIndex - 1];
  const after = frames[nextIndex];
  const span = Math.max(1, after.atMs - before.atMs);
  const progress = ease((timeMs - before.atMs) / span, after.easing);
  const mixed = { atMs:timeMs, easing:after.easing };
  for (const field of ['x', 'y', 'width', 'opacity', 'scale', 'tailX', 'tailY']) {
    mixed[field] = round(before[field] + (after[field] - before[field]) * progress);
  }
  return mixed;
}

export function sampleLetteringTimeline(value, timeMs = 0, options = {}) {
  const timeline = normalizeLetteringTimeline(value, options.dialogue || [], options);
  const atMs = clamp(number(timeMs, timeline.posterTimeMs), 0, timeline.durationMs);
  return timeline.tracks.map((track) => {
    const frame = sampleFrame(track, atMs);
    const text = sampleText(track, atMs);
    return {
      id: track.id,
      actorId: track.actorId,
      followsActor: track.followsActor,
      actorOffsetX: track.actorOffsetX,
      actorOffsetY: track.actorOffsetY,
      speaker: track.speaker,
      type: track.type,
      side: track.side,
      text,
      line:text,
      visible:Boolean(text) && frame.opacity > 0.001,
      ...frame,
      layout:{ x:frame.x, y:frame.y, width:frame.width, source:'nex' },
    };
  }).filter((frame) => options.includeHidden || frame.visible);
}

// A static comic must keep showing its strongest selected dialogue even when
// the animation cues speak those lines at different times. This projects one
// representative state per track without flattening or destroying the timeline.
export function posterLetteringFrames(value, dialogue = [], options = {}) {
  const timeline = normalizeLetteringTimeline(value, dialogue, options);
  return timeline.tracks.map((track) => {
    const frame = sampleFrame(track, timeline.posterTimeMs);
    const text = sampleText(track, timeline.posterTimeMs) || track.textCues[0]?.text || '';
    return {
      id:track.id,
      actorId:track.actorId,
      followsActor:track.followsActor,
      actorOffsetX:track.actorOffsetX,
      actorOffsetY:track.actorOffsetY,
      speaker:track.speaker,
      type:track.type,
      side:track.side,
      text,
      line:text,
      visible:Boolean(text),
      ...frame,
      opacity:1,
      layout:{x:frame.x,y:frame.y,width:frame.width,source:'nex'},
    };
  }).filter((frame) => frame.visible);
}

function upsertKeyframe(track, atMs, changes, durationMs) {
  const sampled = sampleFrame(track, atMs);
  const next = normalizeKeyframe({ ...sampled, ...changes, atMs }, sampled, durationMs);
  const withoutSameTime = track.keyframes.filter((frame) => frame.atMs !== next.atMs);
  track.keyframes = [...withoutSameTime, next].sort((a, b) => a.atMs - b.atMs).slice(-MAX_KEYFRAMES);
}

export function applyNexLetteringOperations(value, dialogue = [], operations = [], options = {}) {
  const timeline = normalizeLetteringTimeline(value, dialogue, options);
  const items = Array.isArray(operations) ? operations.slice(0, 64) : [];
  for (const operation of items) {
    const type = cleanText(operation?.type, 40);
    if (type === 'set-duration') {
      timeline.durationMs = normalizeDuration(operation.durationMs);
      continue;
    }
    if (type === 'set-poster-time') {
      timeline.posterTimeMs = Math.round(clamp(number(operation.atMs, 0), 0, timeline.durationMs));
      continue;
    }
    if (type === 'add-track' && timeline.tracks.length < MAX_TRACKS) {
      const index = timeline.tracks.length;
      const fallback = {
        actorId:operation.actorId,
        speaker:operation.speaker,
        line:operation.text,
        type:operation.bubbleType,
        side:operation.side,
        startMs:operation.startMs,
        endMs:operation.endMs,
        layout:operation,
      };
      timeline.tracks.push(normalizeTrack({id:operation.trackId,actorId:operation.actorId}, fallback, index, timeline.durationMs));
      continue;
    }
    const id = trackId(operation?.trackId, -1);
    const track = timeline.tracks.find((candidate) => candidate.id === id);
    if (!track) continue;
    if (type === 'remove-track') {
      timeline.tracks = timeline.tracks.filter((candidate) => candidate.id !== id);
    } else if (type === 'set-text') {
      const cue = normalizeTextCue(operation, operation.text, timeline.durationMs);
      if (cue.text) track.textCues = [...track.textCues, cue].sort((a, b) => a.startMs - b.startMs).slice(-MAX_TEXT_CUES);
    } else if (type === 'move') {
      upsertKeyframe(track, Math.round(number(operation.atMs, 0)), {
        x:operation.x,
        y:operation.y,
        ...(operation.width === undefined ? {} : {width:operation.width}),
        ...(operation.easing === undefined ? {} : {easing:operation.easing}),
      }, timeline.durationMs);
    } else if (type === 'resize') {
      upsertKeyframe(track, Math.round(number(operation.atMs, 0)), {width:operation.width,scale:operation.scale,easing:operation.easing}, timeline.durationMs);
    } else if (type === 'show' || type === 'hide') {
      upsertKeyframe(track, Math.round(number(operation.atMs, 0)), {opacity:type === 'show' ? 1 : 0,easing:operation.easing}, timeline.durationMs);
    } else if (type === 'retarget-tail') {
      upsertKeyframe(track, Math.round(number(operation.atMs, 0)), {tailX:operation.tailX,tailY:operation.tailY,easing:operation.easing}, timeline.durationMs);
    } else if (type === 'attach-to-actor') {
      track.actorId = actorId(operation.actorId || track.speaker);
      track.followsActor = operation.followsActor !== false;
      track.actorOffsetX = round(clamp(number(operation.offsetX, track.actorOffsetX), -300, 300));
      track.actorOffsetY = round(clamp(number(operation.offsetY, track.actorOffsetY), -300, 300));
    } else if (type === 'set-style') {
      if (['speech', 'thought', 'shout'].includes(operation.bubbleType)) track.type = operation.bubbleType;
      if (operation.side === 'left' || operation.side === 'right') track.side = operation.side;
      if (operation.speaker !== undefined) track.speaker = cleanText(operation.speaker, 80);
    }
  }
  return normalizeLetteringTimeline({
    ...timeline,
    revision:timeline.revision + 1,
    directedBy:'nex',
    updatedAt:Math.max(0, Math.round(number(options.now, Date.now()))),
  }, [], {durationMs:timeline.durationMs,posterTimeMs:timeline.posterTimeMs});
}

export function staticDialogueFromTimeline(dialogue = [], value) {
  const timeline = normalizeLetteringTimeline(value, dialogue);
  const frames = posterLetteringFrames(timeline, dialogue);
  return frames.slice(0, 2).map((frame, index) => ({
    ...(dialogue[index] || {}),
    speaker:frame.speaker,
    line:frame.text,
    type:frame.type,
    side:frame.side,
    layout:{x:frame.x,y:frame.y,width:frame.width,source:'vision'},
  }));
}

export const __internals = { MAX_TRACKS, MAX_TEXT_CUES, MAX_KEYFRAMES, defaultLayout };
