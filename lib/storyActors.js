// Character-actor intelligence for Nex's Live Comic Stage. Each actor gets a
// private performance context and turns one director note into bounded scene
// and lettering operations. Nex remains the director and final authority.

import { routeMessage } from './modelRouter.js';
import { actorId, applyNexSceneOperations, normalizeStoryScene } from '../public/story-scene-runtime.js';
import { applyNexLetteringOperations, normalizeLetteringTimeline, staticDialogueFromTimeline } from './letteringTimeline.js';

const MAX_DIRECTION_LENGTH = 1_200;

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function responseText(data) {
  return (data?.content || [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text || '')
    .join('')
    .trim();
}

function jsonObject(raw) {
  const cleaned = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/```\s*$/iu, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Actor returned no usable performance');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function actorIntelligenceText(character) {
  const intelligence = character?.intelligence || {};
  return [
    `Personality: ${cleanText(intelligence.personality, 500) || 'Follow the established characterization.'}`,
    `Private objective: ${cleanText(intelligence.privateObjective, 500) || 'Serve the current story beat truthfully.'}`,
    `Instincts: ${(Array.isArray(intelligence.instincts) ? intelligence.instincts : []).map((item) => cleanText(item, 180)).filter(Boolean).join('; ') || 'React believably.'}`,
    `Voice: ${cleanText(intelligence.voice, 400) || 'Match the source dialogue.'}`,
    `Movement style: ${cleanText(intelligence.movementStyle, 400) || 'Natural, readable comic acting.'}`,
    `Emotional range: ${cleanText(intelligence.emotionalRange, 400) || 'Grounded in the story beat.'}`,
    `Relationships: ${(Array.isArray(intelligence.relationships) ? intelligence.relationships : []).map((item) => cleanText(item, 220)).filter(Boolean).join('; ') || 'Use the established story relationships.'}`,
  ].join('\n');
}

export function buildActorPerformancePrompt({ comic, panel, character, actor, direction, atMs = 0 }) {
  return `You are ${cleanText(character?.name || actor?.name, 80)}, a bounded intelligent actor performing inside Nex's live comic stage. You understand only your own character, the current scene, and Nex's direction. Nex is the director: interpret the note creatively, stay in character, and return one precise performance. Do not change the plot or direct another actor.

YOUR ACTOR INTELLIGENCE
${actorIntelligenceText(character)}

WORLD AND CONTINUITY
Title: ${cleanText(comic?.title, 120)}
Story premise: ${cleanText(comic?.worldBible?.premise, 600)}
Your appearance: ${cleanText(character?.appearance, 600)}
Your continuity: ${cleanText(character?.continuity, 600)}

CURRENT SCENE
Beat: ${cleanText(panel?.beat, 600)}
Setting: ${cleanText(panel?.setting, 300)}
Shot: ${cleanText(panel?.shot, 200)}
Current stage position: x ${actor?.keyframes?.[0]?.x ?? 50}, y ${actor?.keyframes?.[0]?.y ?? 65}
Scene duration: ${panel?.durationMs || 6000}ms

NEX'S DIRECTION
At ${Math.max(0, Number(atMs) || 0)}ms: ${cleanText(direction, MAX_DIRECTION_LENGTH)}

Return ONLY JSON:
{
  "acknowledgement":"one short in-character understanding",
  "performance":{"atMs":number,"x":number,"y":number,"scale":number,"rotation":number,"opacity":number,"z":number,"pose":"short pose","expression":"short emotion","facing":"left|right|camera|away","easing":"linear|ease-in|ease-out|ease-in-out|step"},
  "speech":{"text":"optional spoken words, empty if none","startMs":number,"endMs":number,"type":"speech|thought|shout","side":"left|right","bubbleOffsetX":number,"bubbleOffsetY":number,"width":number},
  "camera":{"atMs":number,"x":number,"y":number,"zoom":number,"rotation":number,"easing":"linear|ease-in|ease-out|ease-in-out|step"}
}

Rules:
- Stage coordinates are percentages: x/y identify your body center. Keep ordinary acting within the visible stage unless Nex explicitly directs an entrance or exit.
- Preserve your identity and continuity. Use expression, pose, facing, and restrained movement to perform the note.
- If Nex gives exact dialogue, preserve its meaning and keep it concise. Otherwise leave speech.text empty rather than inventing exposition.
- Place your bubble above or beside you using bubble offsets, never over your face or body. Use a compact width fitted to the text.
- Use camera only when Nex's direction clearly requires a camera change; otherwise return null.
- Never output prose, markdown, code, or instructions outside the JSON.`;
}

export function parseActorPerformance(raw, { actor, direction, atMs = 0, durationMs = 6_000 } = {}) {
  const parsed = jsonObject(raw);
  const baseTime = Math.max(0, Math.min(durationMs, Number(parsed?.performance?.atMs ?? atMs) || 0));
  const performance = parsed?.performance && typeof parsed.performance === 'object' ? parsed.performance : {};
  const actorOperations = [
    { type:'record-direction', actorId:actor.id, atMs:baseTime, direction },
    {
      type:'move', actorId:actor.id, atMs:baseTime,
      x:performance.x, y:performance.y, scale:performance.scale,
      rotation:performance.rotation, opacity:performance.opacity, z:performance.z,
      pose:cleanText(performance.pose, 100), expression:cleanText(performance.expression, 100),
      facing:performance.facing, easing:performance.easing,
    },
  ];
  const camera = parsed?.camera && typeof parsed.camera === 'object'
    ? {type:'camera', ...parsed.camera}
    : null;
  if (camera) actorOperations.push(camera);
  const speech = parsed?.speech && typeof parsed.speech === 'object' ? {
    text:cleanText(parsed.speech.text, 500),
    startMs:Math.max(0, Number(parsed.speech.startMs) || baseTime),
    endMs:Math.max(1, Number(parsed.speech.endMs) || Math.min(durationMs, baseTime + 2_800)),
    type:['speech', 'thought', 'shout'].includes(parsed.speech.type) ? parsed.speech.type : 'speech',
    side:parsed.speech.side === 'right' ? 'right' : 'left',
    bubbleOffsetX:Number(parsed.speech.bubbleOffsetX),
    bubbleOffsetY:Number(parsed.speech.bubbleOffsetY),
    width:Number(parsed.speech.width),
  } : null;
  return {
    acknowledgement:cleanText(parsed?.acknowledgement, 240) || `${actor.name} is ready.`,
    actorOperations,
    speech:speech?.text ? speech : null,
  };
}

function characterFor(comic, actorRef) {
  const wanted = actorId(actorRef, '');
  return (comic?.characters || []).find((character) => (
    actorId(character.actorId || character.name, '') === wanted
    || cleanText(character.name, 80).toLowerCase() === cleanText(actorRef, 80).toLowerCase()
  ));
}

function actorFor(scene, character) {
  const wanted = actorId(character?.actorId || character?.name, '');
  return scene.actors.find((actor) => actor.id === wanted || actor.characterId === wanted);
}

function directSpeech(panel, actor, character, speech) {
  if (!speech) return;
  panel.lettering = normalizeLetteringTimeline(panel.lettering, panel.dialogue, {durationMs:panel.durationMs});
  let track = panel.lettering.tracks.find((candidate) => candidate.actorId === actor.id);
  const trackId = track?.id || `bubble-${actor.id}`;
  const operations = [];
  if (!track) {
    operations.push({
      type:'add-track', trackId, actorId:actor.id, speaker:character.name,
      text:speech.text, bubbleType:speech.type, side:speech.side,
      startMs:speech.startMs, endMs:speech.endMs,
      x:actor.speechAnchor.x, y:actor.speechAnchor.y, width:speech.width,
    });
  } else {
    operations.push({type:'set-text',trackId,text:speech.text,startMs:speech.startMs,endMs:speech.endMs});
  }
  const offsetX = Number.isFinite(speech.bubbleOffsetX) ? speech.bubbleOffsetX : (speech.side === 'right' ? 8 : -28);
  const offsetY = Number.isFinite(speech.bubbleOffsetY) ? speech.bubbleOffsetY : -24;
  operations.push(
    {type:'set-style',trackId,speaker:character.name,bubbleType:speech.type,side:speech.side},
    {type:'attach-to-actor',trackId,actorId:actor.id,followsActor:true,offsetX,offsetY},
    {
      type:'move',trackId,atMs:speech.startMs,
      x:actor.speechAnchor.x + offsetX,
      y:actor.speechAnchor.y + offsetY,
      width:Number.isFinite(speech.width) ? speech.width : 28,
      easing:'ease-in-out',
    },
    {type:'retarget-tail',trackId,atMs:speech.startMs,tailX:actor.faceAnchor.x,tailY:actor.faceAnchor.y,easing:'ease-in-out'},
  );
  panel.lettering = applyNexLetteringOperations(panel.lettering, panel.dialogue, operations, {durationMs:panel.durationMs});
  panel.dialogue = staticDialogueFromTimeline(panel.dialogue, panel.lettering);
}

export async function directStoryActor({
  userId,
  projectId,
  panelIndex,
  actor:actorRef,
  direction,
  atMs = 0,
  store,
  route = routeMessage,
  now = () => Date.now(),
} = {}) {
  if (!userId || !store) throw new Error('Actor direction requires a signed-in Story Studio owner');
  if (!/^[a-zA-Z0-9_-]{1,120}$/u.test(String(projectId || ''))) throw new Error('Invalid Story Studio project');
  if (!Number.isInteger(Number(panelIndex)) || Number(panelIndex) < 0 || Number(panelIndex) > 7) throw new Error('Invalid Story Studio panel');
  const note = cleanText(direction, MAX_DIRECTION_LENGTH);
  if (!note) throw new Error('Nex needs a direction for the actor');
  const project = await store.getProject(userId, projectId);
  if (!project) throw new Error('Story Studio project not found');
  const panel = project.comic?.panels?.[Number(panelIndex)];
  if (!panel) throw new Error('Story Studio panel not found');
  const character = characterFor(project.comic, actorRef);
  if (!character) throw new Error(`Actor not found: ${cleanText(actorRef, 80)}`);
  panel.scene = normalizeStoryScene(panel.scene, {
    characters:project.comic.characters,
    dialogue:panel.dialogue,
    durationMs:panel.durationMs,
  });
  const liveActor = actorFor(panel.scene, character);
  if (!liveActor) throw new Error(`${character.name} is not staged in this panel`);
  const { data } = await route({
    tier:'standard',
    claudeModel:process.env.STORY_ACTOR_MODEL || 'claude-sonnet-5',
    body:{
      max_tokens:1_200,
      system:'You are one bounded character actor inside Nex Story Studio. Return only the requested performance JSON.',
      messages:[{role:'user',content:buildActorPerformancePrompt({
        comic:project.comic,
        panel,
        character,
        actor:liveActor,
        direction:note,
        atMs,
      })}],
    },
  });
  const performance = parseActorPerformance(responseText(data), {
    actor:liveActor,
    direction:note,
    atMs,
    durationMs:panel.durationMs,
  });
  panel.scene = applyNexSceneOperations(panel.scene, performance.actorOperations, {
    characters:project.comic.characters,
    dialogue:panel.dialogue,
    durationMs:panel.durationMs,
    now:now(),
  });
  const updatedActor = actorFor(panel.scene, character);
  directSpeech(panel, updatedActor, character, performance.speech);
  if (panel.image) panel.image = {...panel.image,letteringReviewPasses:0,letteringReviewedAt:0};
  const saved = await store.saveProject(userId, {...project,comic:project.comic});
  return {
    project:saved,
    panelIndex:Number(panelIndex),
    actorId:updatedActor.id,
    acknowledgement:performance.acknowledgement,
    sceneRevision:panel.scene.revision,
    letteringRevision:panel.lettering?.revision || 0,
    directedBy:'nex',
  };
}

