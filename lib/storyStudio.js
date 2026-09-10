// Private, per-account Story Studio projects. The first golden path keeps one
// chapter, its continuity bible, and its editable comic plan together so a
// customer can leave and come back without losing the story world.

import { COMIC_DIRECTOR_BIBLE_VERSION } from './comicDirectorBible.js';
import { DEFAULT_PANEL_DURATION_MS, MAX_PANEL_DURATION_MS, normalizeLetteringTimeline } from './letteringTimeline.js';
import { actorId, normalizeStoryScene } from '../public/story-scene-runtime.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const PROJECT_LIMIT = 20;
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const MAX_SOURCE_LENGTH = 30_000;
const MAX_PANELS = 8;
const MAX_CHARACTERS = 12;
const MAX_LOCATIONS = 8;
const MAX_RECURRING_PROPS = 8;
const VISUAL_ROLES = new Set(['establishing','action','reaction','detail','reveal','aftermath']);

function encodeKey(value) {
  return encodeURIComponent(String(value));
}

function projectKey(userId) {
  return `nexus:story-studio:projects:${encodeKey(userId)}`;
}

function indexKey(userId) {
  return `nexus:story-studio:index:${encodeKey(userId)}`;
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function cleanStringList(value, maxItems = 8, maxLength = 100) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function visualRole(value, shot = '') {
  const requested = cleanText(value, 30).toLowerCase();
  if (VISUAL_ROLES.has(requested)) return requested;
  const text = cleanText(shot, 180).toLowerCase();
  if (/wide|establish|exterior|landscape/.test(text)) return 'establishing';
  if (/close|portrait|reaction|face/.test(text)) return 'reaction';
  if (/insert|detail|extreme/.test(text)) return 'detail';
  if (/reveal|threat|discover/.test(text)) return 'reveal';
  return 'action';
}

function normalizeBubbleLayout(value) {
  if (!value || typeof value !== 'object') return null;
  const rawX = Number(value.x);
  const rawY = Number(value.y);
  const rawWidth = Number(value.width);
  if (![rawX, rawY, rawWidth].every(Number.isFinite)) return null;
  const width = Math.max(20, Math.min(44, rawWidth));
  const x = Math.max(2, Math.min(98 - width, rawX));
  const y = Math.max(3, Math.min(78, rawY));
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    width: Math.round(width * 10) / 10,
    source: value.source === 'manual' ? 'manual' : 'vision',
  };
}

function normalizeDialogue(value, durationMs = DEFAULT_PANEL_DURATION_MS) {
  if (!Array.isArray(value)) return [];
  return value.map((line, index) => {
    const startMs = Math.max(0, Math.min(durationMs - 1, Number(line?.startMs) || index * 2_000));
    const endMs = Math.max(startMs + 1, Math.min(durationMs, Number(line?.endMs) || Math.min(durationMs, startMs + 2_800)));
    return {
    speaker: cleanText(line?.speaker, 80),
    actorId: actorId(line?.actorId || line?.speaker, ''),
    line: cleanText(line?.line, 500),
    type: ['speech', 'thought', 'shout'].includes(line?.type) ? line.type : 'speech',
    // Which side of the panel this line's bubble belongs on. Comes either from
    // Nex's own read of where the speaking character sits in the shot, or from
    // a human overriding it in the editor. Anything else (missing, "auto",
    // "center", or an invalid value) falls back to the per-speaker alternation
    // heuristic in createBubbleLayer — never trust this as a layout guarantee.
    side: ['left', 'right'].includes(line?.side) ? line.side : null,
    layout: normalizeBubbleLayout(line?.layout),
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
    };
  }).filter((line) => line.line).slice(0, 6);
}

function normalizeActorIntelligence(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    personality: cleanText(input.personality, 500),
    privateObjective: cleanText(input.privateObjective, 500),
    instincts: cleanStringList(input.instincts, 8, 220),
    voice: cleanText(input.voice, 400),
    movementStyle: cleanText(input.movementStyle, 400),
    emotionalRange: cleanText(input.emotionalRange, 400),
    relationships: cleanStringList(input.relationships, 10, 260),
  };
}

function normalizeWorldBible(value) {
  const input = value && typeof value === 'object' ? value : {};
  const locations = (Array.isArray(input.locations) ? input.locations : [])
    .map((location) => ({
      name: cleanText(location?.name, 100),
      visualIdentity: cleanText(location?.visualIdentity, 600),
      continuity: cleanText(location?.continuity, 600),
    }))
    .filter((location) => location.name)
    .slice(0, MAX_LOCATIONS);
  const recurringProps = (Array.isArray(input.recurringProps) ? input.recurringProps : [])
    .map((prop) => ({
      name: cleanText(prop?.name, 100),
      appearance: cleanText(prop?.appearance, 500),
      continuity: cleanText(prop?.continuity, 500),
    }))
    .filter((prop) => prop.name)
    .slice(0, MAX_RECURRING_PROPS);
  return {
    premise: cleanText(input.premise, 600),
    era: cleanText(input.era, 240),
    storyRules: cleanStringList(input.storyRules, 10, 300),
    locations,
    recurringProps,
    visualMotifs: cleanStringList(input.visualMotifs, 8, 220),
    colorScript: cleanStringList(input.colorScript, 8, 220),
    animationLanguage: cleanText(input.animationLanguage, 600),
    soundLanguage: cleanText(input.soundLanguage, 600),
  };
}

function normalizePanelImage(value) {
  const url = cleanText(value?.url, 500);
  if (!/^\/api\/story-image\?id=[a-zA-Z0-9_%.-]+&panel=\d+&v=\d+$/.test(url)) return null;
  return {
    url,
    model: cleanText(value?.model, 160),
    generationId:cleanText(value?.generationId, 80),
    generatedAt: Math.max(0, Number(value?.generatedAt) || 0),
    layered:value?.layered === true,
    needsSetRetry:value?.needsSetRetry === true,
    setIssues:cleanStringList(value?.setIssues, 6, 64)
      .filter((issue) => ['generated_text','blank_lettering_box','no_safe_lettering_space','unauthorized_character'].includes(issue)),
    missingActors:cleanStringList(value?.missingActors, MAX_CHARACTERS, 64)
      .filter((id) => /^[a-z0-9][a-z0-9-]{0,63}$/u.test(id)),
    letteringReviewPasses: Math.max(0, Math.min(3, Number(value?.letteringReviewPasses) || 0)),
    letteringReviewedAt: Math.max(0, Number(value?.letteringReviewedAt) || 0),
  };
}

function normalizeVisualIdentity(value) {
  const assetUrl = cleanText(value?.assetUrl, 500);
  if (!/^\/api\/story-actor\?id=[a-zA-Z0-9_%.-]+&actor=[a-z0-9-]+&kind=identity&v=\d+$/u.test(assetUrl)) return null;
  return {
    assetUrl,
    model:cleanText(value?.model,160),
    generationId:cleanText(value?.generationId,80),
    generatedAt:Math.max(0,Number(value?.generatedAt) || 0),
  };
}

export function normalizeComicPlan(value) {
  const input = value && typeof value === 'object' ? value : {};
  const palette = cleanStringList(input.palette, 6, 20)
    .filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  const characters = (Array.isArray(input.characters) ? input.characters : [])
    .map((character) => {
      const name = cleanText(character?.name, 80);
      return {
        actorId: actorId(character?.actorId || name, ''),
        name,
        role: cleanText(character?.role, 120),
        appearance: cleanText(character?.appearance, 600),
        continuity: cleanText(character?.continuity, 600),
        intelligence: normalizeActorIntelligence(character?.intelligence),
        visualIdentity:normalizeVisualIdentity(character?.visualIdentity),
      };
    })
    .filter((character) => character.name)
    .slice(0, MAX_CHARACTERS);
  const panels = (Array.isArray(input.panels) ? input.panels : [])
    .map((panel, index) => {
      const durationMs = Math.round(Math.max(1_000, Math.min(MAX_PANEL_DURATION_MS, Number(panel?.durationMs) || DEFAULT_PANEL_DURATION_MS)));
      const dialogue = normalizeDialogue(panel?.dialogue, durationMs);
      const scene = normalizeStoryScene(panel?.scene, {characters,dialogue,durationMs});
      return {
        number: index + 1,
        title: cleanText(panel?.title, 100) || `Panel ${index + 1}`,
        visualRole: visualRole(panel?.visualRole, panel?.shot),
        beat: cleanText(panel?.beat, 600),
        shot: cleanText(panel?.shot, 160),
        setting: cleanText(panel?.setting, 240),
        caption: cleanText(panel?.caption, 600),
        durationMs,
        scene,
        dialogue,
        lettering: normalizeLetteringTimeline(panel?.lettering, dialogue, {durationMs}),
        artDirection: cleanText(panel?.artDirection, 1_000),
        image: normalizePanelImage(panel?.image),
      };
    })
    .filter((panel) => panel.beat || panel.caption || panel.dialogue.length || panel.artDirection)
    .slice(0, MAX_PANELS);

  if (panels.length < 3) throw new Error('Story plan needs at least three usable panels');
  return {
    directorBibleVersion: COMIC_DIRECTOR_BIBLE_VERSION,
    title: cleanText(input.title, 120) || 'Untitled chapter',
    logline: cleanText(input.logline, 500),
    genre: cleanText(input.genre, 100),
    visualStyle: cleanText(input.visualStyle, 300),
    palette: palette.length ? palette : ['#58d7ff', '#a879ff', '#0b1422'],
    worldBible: normalizeWorldBible(input.worldBible),
    characters,
    panels,
  };
}

export function parseComicPlan(raw) {
  const cleaned = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Story Studio response was not JSON');
  return normalizeComicPlan(JSON.parse(cleaned.slice(start, end + 1)));
}

// Fresh basic comics are intentionally sparse: Nex chooses the strongest two
// lines and keeps production notation out of the lettering customers see.
// Existing saved projects still normalize up to six lines for compatibility.
export function prepareBasicComicPlan(value) {
  const comic = normalizeComicPlan(value);
  comic.panels = comic.panels.map((panel) => {
    const dialogue = panel.dialogue.slice(0, 2).map((entry) => ({
      ...entry,
      speaker: entry.speaker.replace(/\s*\([^)]*\)\s*$/u, '').trim(),
      actorId: actorId(entry.actorId || entry.speaker.replace(/\s*\([^)]*\)\s*$/u, '').trim(), ''),
      layout: null,
    }));
    const scene = normalizeStoryScene(panel.scene, {characters:comic.characters,dialogue,durationMs:panel.durationMs});
    const tracks = dialogue.map((entry, index) => {
      const stagedActor = scene.actors.find((actor) => actor.id === entry.actorId || actor.characterId === entry.actorId);
      const width = entry.line.length <= 20 ? 23 : entry.line.length <= 42 ? 30 : entry.line.length <= 70 ? 35 : 40;
      const x = entry.side === 'right' ? 96 - width : 4;
      const y = 10 + index * 24;
      return {
        id:`bubble-${index + 1}`,
        actorId:entry.actorId,
        followsActor:Boolean(stagedActor),
        actorOffsetX:stagedActor ? x - stagedActor.speechAnchor.x : 0,
        actorOffsetY:stagedActor ? y - stagedActor.speechAnchor.y : -22,
      };
    });
    return {
      ...panel,
      dialogue,
      scene,
      lettering: normalizeLetteringTimeline({tracks}, dialogue, {durationMs:panel.durationMs}),
    };
  });
  return comic;
}

async function defaultRedisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('storyStudio redis command failed', command[0], response.status);
    throw new Error(`Story Studio ${command[0]} failed`);
  }
  return data.result;
}

export function createStoryStudioStore({ command = defaultRedisCommand, now = () => Date.now() } = {}) {
  async function saveProject(userId, input) {
    if (!userId) throw new Error('Story Studio requires a user id');
    const id = PROJECT_ID_RE.test(String(input?.id || ''))
      ? String(input.id)
      : `${now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previousRaw = await command(['HGET', projectKey(userId), id]);
    let previous = {};
    if (previousRaw) {
      try { previous = JSON.parse(previousRaw); } catch { previous = {}; }
    }
    const sourceText = cleanText(input?.sourceText ?? previous.sourceText, MAX_SOURCE_LENGTH);
    if (sourceText.length < 100) throw new Error('A chapter needs at least 100 characters');
    const timestamp = now();
    const project = {
      id,
      sourceTitle: cleanText(input?.sourceTitle ?? previous.sourceTitle, 120) || 'Untitled chapter',
      sourceText,
      rightsBasis: cleanText(input?.rightsBasis ?? previous.rightsBasis, 80) || 'confirmed-by-user',
      comic: normalizeComicPlan(input?.comic ?? previous.comic),
      createdAt: Number(previous.createdAt) || timestamp,
      updatedAt: timestamp,
    };
    await command(['HSET', projectKey(userId), id, JSON.stringify(project)]);
    await command(['ZADD', indexKey(userId), String(timestamp), id]);
    const overflow = await command(['ZREVRANGE', indexKey(userId), String(PROJECT_LIMIT), '-1']);
    if (Array.isArray(overflow) && overflow.length) {
      await command(['HDEL', projectKey(userId), ...overflow]);
      await command(['ZREM', indexKey(userId), ...overflow]);
    }
    return project;
  }

  async function listProjects(userId) {
    if (!userId) throw new Error('Story Studio requires a user id');
    const ids = await command(['ZREVRANGE', indexKey(userId), '0', String(PROJECT_LIMIT - 1)]);
    if (!Array.isArray(ids) || !ids.length) return [];
    const rows = await command(['HMGET', projectKey(userId), ...ids]);
    return (Array.isArray(rows) ? rows : []).map((raw) => {
      try {
        const project = JSON.parse(raw);
        return {
          id: project.id,
          sourceTitle: project.sourceTitle,
          comicTitle: project.comic?.title || project.sourceTitle,
          panelCount: Array.isArray(project.comic?.panels) ? project.comic.panels.length : 0,
          updatedAt: project.updatedAt,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  async function getProject(userId, id) {
    if (!userId) throw new Error('Story Studio requires a user id');
    if (!PROJECT_ID_RE.test(String(id || ''))) return null;
    const raw = await command(['HGET', projectKey(userId), String(id)]);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async function deleteProject(userId, id) {
    if (!userId) throw new Error('Story Studio requires a user id');
    if (!PROJECT_ID_RE.test(String(id || ''))) throw new Error('Invalid Story Studio project id');
    const removed = await command(['HDEL', projectKey(userId), String(id)]);
    await command(['ZREM', indexKey(userId), String(id)]);
    return Number(removed) > 0;
  }

  return { saveProject, listProjects, getProject, deleteProject };
}

export const storyStudioStore = createStoryStudioStore();
export const __internals = {
  PROJECT_LIMIT,
  PROJECT_ID_RE,
  MAX_SOURCE_LENGTH,
  MAX_PANELS,
  MAX_CHARACTERS,
  MAX_LOCATIONS,
  MAX_RECURRING_PROPS,
};
