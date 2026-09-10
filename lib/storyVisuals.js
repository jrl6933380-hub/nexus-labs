// Story Studio visual engine: turn one continuity-aware panel plan into real
// generated art, then persist the image privately per customer and project.

import { comicDirectorGuidance, storyWorldBibleText } from './comicDirectorBible.js';
import { randomUUID } from 'node:crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export const DEFAULT_STORY_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
export const DEFAULT_STORY_ACTOR_IMAGE_MODEL = 'openai/gpt-image-2';
export const DEFAULT_STORY_VISION_MODEL = 'openai/gpt-5.4';
const GATEWAY_IMAGE_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const GATEWAY_IMAGE_GENERATION_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/images/generations';
const GATEWAY_IMAGE_EDIT_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/images/edits';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PANEL_LIMIT = 8;
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function encodeKey(value) {
  return encodeURIComponent(String(value));
}

function assetKey(userId, projectId, panelIndex) {
  return `nexus:story-studio:visual:${encodeKey(userId)}:${encodeKey(projectId)}:background:${panelIndex}`;
}

function actorAssetKey(userId, projectId, panelIndex, actor) {
  return `nexus:story-studio:visual:${encodeKey(userId)}:${encodeKey(projectId)}:actor:${panelIndex}:${encodeKey(actor)}`;
}

function identityAssetKey(userId, projectId, actor) {
  return `nexus:story-studio:visual:${encodeKey(userId)}:${encodeKey(projectId)}:identity:${encodeKey(actor)}`;
}

function validPanelIndex(value) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < PANEL_LIMIT;
}

function cleanText(value, max = 1_000) {
  return String(value || '').trim().slice(0, max);
}

function validActorId(value) {
  return /^[a-z0-9][a-z0-9-]{0,63}$/u.test(String(value || ''));
}

export function parseImageDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match || !MEDIA_TYPES.has(match[1])) throw new Error('Image provider returned an unsupported image');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Generated image exceeded the safe size limit');
  return { mediaType: match[1], base64: match[2], bytes };
}

function characterBible(comic) {
  const characters = Array.isArray(comic?.characters) ? comic.characters : [];
  return characters.map((character) => [
    `${cleanText(character.name, 80)} (${cleanText(character.role, 120)})`,
    cleanText(character.appearance, 600),
    cleanText(character.continuity, 600),
  ].filter(Boolean).join(' — ')).join('\n');
}

function stagedActors(panel) {
  return (Array.isArray(panel?.scene?.actors) ? panel.scene.actors : [])
    .map((actor) => `${cleanText(actor.id || actor.actorId || actor.characterId, 64)} = ${cleanText(actor.name, 80)}`)
    .filter(Boolean)
    .join('\n');
}

function artworkDirectorGuidance(panel) {
  return comicDirectorGuidance('illustration', { panel })
    .split('\n')
    .filter((line) => !line.startsWith('NEX COMIC DIRECTOR BIBLE'))
    .map((line) => line.replace(/^\d+\.\s*/u, '- '))
    .join('\n');
}

function bubbleWidthRange(line) {
  const length = cleanText(line?.line, 500).length;
  if (length <= 20) return { min:20, max:26 };
  if (length <= 42) return { min:26, max:34 };
  if (length <= 70) return { min:30, max:40 };
  return { min:34, max:44 };
}

export function buildBubbleReservations(dialogue) {
  const lines = (Array.isArray(dialogue) ? dialogue : []).filter((line) => line?.line).slice(0, 2);
  const sideCounts = { left:0, right:0 };
  return lines.map((line) => {
    const side = line?.side === 'right' ? 'right' : 'left';
    const placement = sideCounts[side] === 0 ? `upper ${side}` : `outer ${side}`;
    const length = cleanText(line?.line, 500).length;
    const size = length <= 20 ? 'small and compact' : length <= 42 ? 'compact and horizontal' : 'wide and horizontal';
    sideCounts[side] += 1;
    return `Preserve ${size} calm background near the ${placement} of the speaker; keep the face, body, hands, props, and action completely outside that open area.`;
  }).join('\n');
}

export function buildCharacterIdentityPrompt({ comic, character }) {
  return `Create the canonical reusable visual identity for one original comic character.

COMIC WORLD
Title: ${cleanText(comic?.title, 120)}
Genre: ${cleanText(comic?.genre, 100)}
Visual style: ${cleanText(comic?.visualStyle, 300)}
${storyWorldBibleText(comic)}

CHARACTER
Name: ${cleanText(character?.name, 80)}
Story role: ${cleanText(character?.role, 120)}
Locked appearance: ${cleanText(character?.appearance, 600)}
Continuity: ${cleanText(character?.continuity, 600)}

ART-DEPARTMENT CONTRACT
- Return exactly one complete, head-to-toe character on a real transparent alpha background.
- Use a neutral three-quarter standing pose with the face, hair, silhouette, costume, footwear, and signature props completely visible.
- This image is the character's reusable likeness and wardrobe reference. Make every design choice specific enough to repeat in later poses.
- Keep the full body comfortably inside the canvas with transparent breathing room on every edge.
- Draw no floor, scenery, shadow rectangle, color card, checkerboard, frame, lettering, logo, symbol, number, label, bubble, watermark, or extra person.
- Preserve the comic's production style while keeping the design commercially original. Never imitate a named living artist.`;
}

function actorBlockingSummary(panel) {
  return (Array.isArray(panel?.scene?.actors) ? panel.scene.actors : [])
    .map((actor) => {
      const frame = actor?.keyframes?.[0] || actor?.blocking || {};
      return `${cleanText(actor?.name, 80)} stages around x=${Math.round(Number(frame.x) || 50)}, y=${Math.round(Number(frame.y) || 65)} with pose ${cleanText(frame.pose, 100) || 'story-ready'}.`;
    })
    .join('\n');
}

export function buildBackgroundPlatePrompt({ comic, panel }) {
  return `Create one clean full-bleed landscape background plate for a layered comic stage.

STORY WORLD
Title: ${cleanText(comic?.title, 120)}
Genre: ${cleanText(comic?.genre, 100)}
Visual style: ${cleanText(comic?.visualStyle, 300)}
${storyWorldBibleText(comic)}

THIS SET AND CAMERA
Story beat: ${cleanText(panel?.beat, 700)}
Camera: ${cleanText(panel?.shot, 200)}
Setting: ${cleanText(panel?.setting, 300)}
Art direction: ${cleanText(panel?.artDirection, 1_200)}

INVISIBLE ACTOR BLOCKING
${actorBlockingSummary(panel) || 'No actor blocking is required.'}

ART-DEPARTMENT CONTRACT
- Build only the set, atmosphere, lighting, weather, architecture, furniture, and non-held scenery for this exact camera.
- Do not draw any person, character, creature, body, face, silhouette, held prop, speech bubble, caption, or lettering. Actor layers will be composited later.
- Leave natural walkable/open negative space at the invisible actor blocking positions, but never draw guides or placeholders there.
- Return one landscape comic panel background, not a page, collage, storyboard, character sheet, or UI.
- Never draw words, letters, numbers, signs, labels, coordinates, watermarks, borders, or logos anywhere.
- Match the locked world, recurring location details, palette progression, and production style. Keep it commercially original.`;
}

export function buildActorPerformancePrompt({ comic, panel, actor, character, hasIdentity = false }) {
  const frame = actor?.keyframes?.[0] || actor?.blocking || {};
  return `Create one reusable transparent performance layer for a comic actor.

COMIC STYLE
${cleanText(comic?.visualStyle, 300)}

LOCKED ACTOR
Name: ${cleanText(character?.name || actor?.name, 80)}
Role: ${cleanText(character?.role || actor?.role, 120)}
Appearance: ${cleanText(character?.appearance, 600)}
Continuity: ${cleanText(character?.continuity, 600)}

NEX'S DIRECTION FOR THIS MOMENT
Beat: ${cleanText(panel?.beat, 700)}
Pose: ${cleanText(frame?.pose, 120) || 'story-ready'}
Expression: ${cleanText(frame?.expression, 120) || 'focused'}
Facing: ${cleanText(frame?.facing, 30) || 'camera'}
Action and continuity: ${cleanText(panel?.artDirection, 1_000)}

ACTOR-LAYER CONTRACT
- Return exactly one complete isolated actor on a real transparent alpha background.
- ${hasIdentity ? 'The supplied identity image is binding: preserve the same face, body, hair, costume, colors, footwear, and signature props.' : 'Establish a specific repeatable likeness from the locked actor description.'}
- Perform Nex's exact pose, expression, facing, and physical action while preserving likeness and wardrobe.
- Keep the complete visible silhouette inside the canvas. Do not crop the head, hair, hands, feet, costume, or active prop.
- Draw no set, floor, environment, glow rectangle, color card, checkerboard, frame, lettering, logo, number, label, speech bubble, caption, watermark, or additional person.
- Match the comic style and lighting direction, but keep all pixels outside the actor transparent.`;
}

export function buildPanelVisualPrompt({ comic, panel, panelIndex, hasReference = false }) {
  const reservations = buildBubbleReservations(panel?.dialogue);
  return `Create one finished full-bleed comic-book illustration for this story beat.

STORY WORLD
Title: ${cleanText(comic?.title, 120)}
Genre: ${cleanText(comic?.genre, 100)}
Visual style: ${cleanText(comic?.visualStyle, 300)}

STORY-SPECIFIC WORLD BIBLE
${storyWorldBibleText(comic)}

LOCKED CHARACTER BIBLE
${characterBible(comic) || 'No recurring named character is required in this panel.'}

THIS PANEL ONLY
Story beat: ${cleanText(panel?.beat, 700)}
Camera: ${cleanText(panel?.shot, 200)}
Setting: ${cleanText(panel?.setting, 300)}
Art direction: ${cleanText(panel?.artDirection, 1_200)}

UNPRINTED LETTERING SPACE
${reservations || 'No dialogue bubbles are planned; prioritize the clearest dramatic composition.'}

RENDER RULES
- Produce one full-bleed landscape comic panel, not a page layout, collage, character sheet, or repeated template.
- Return artwork only. Never draw words, letters, numerals, percentages, coordinates, labels, guides, crop marks, interface elements, panel numbers, captions, speech balloons, empty white boxes, or lettering placeholders anywhere in the image.
- Make this scene, action, camera angle, silhouettes, and environment unmistakably specific to this story beat.
- Keep every recurring character's face, body, hair, clothing, colors, and props consistent with the locked bible.
- Treat every UNPRINTED LETTERING SPACE instruction as invisible composition guidance only. Place the speaker close enough for a short natural tail, but keep faces, hands, important props, strong highlights, and the main action completely outside the calm background.
- Keep that background low-detail, but do not visualize it as a box, rectangle, overlay, sign, guide, or placeholder.
${hasReference ? '- Use the supplied reference panel only to preserve the character designs, palette, and art style. Create a genuinely new composition; do not copy its pose or background.' : '- Establish the canonical character designs and visual language that later panels can follow.'}
- Do not include logos, signatures, borders, watermarks, or readable text. The app adds all lettering separately.
- Use original commercial-safe visual language and never imitate a named living artist.

${artworkDirectorGuidance(panel)}`;
}

export function buildPanelVisionPrompt({ panel }) {
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : [])
    .slice(0, 2)
    .map((line, index) => `${index}. ${cleanText(line?.speaker, 80) || 'Unattributed'} [${cleanText(line?.type, 20) || 'speech'}]: ${cleanText(line?.line, 300)}`)
    .join('\n');
  return `Inspect this finished comic panel like a professional letterer and live-stage blocking supervisor. Locate every staged actor, then place one bubble for every numbered dialogue line in visually empty space near its actual speaker while protecting faces, hands, important props, and the main action.

STAGED ACTORS
${stagedActors(panel) || 'No named actor needs blocking metadata.'}

DIALOGUE IN READING ORDER
${dialogue || 'No dialogue.'}

Return ONLY JSON with this shape:
{"artwork":"clean|regenerate","issues":["generated_text|blank_lettering_box|no_safe_lettering_space"],"actors":[{"actorId":"matching staged id","bounds":{"x":number,"y":number,"width":number,"height":number},"faceAnchor":{"x":number,"y":number},"speechAnchor":{"x":number,"y":number}}],"placements":[{"index":0,"side":"left|right","x":number,"y":number,"width":number}]}

Coordinates are percentages of the full panel. x/y are the bubble's top-left corner. width is the bubble width.
- First inspect the raw artwork before placing anything. Set artwork to "regenerate" if it contains any accidental words, letters, numerals, percentages, coordinate notes, panel numbers, labels, UI, crop marks, empty caption boxes, empty speech boxes, or lettering placeholders. Also regenerate if no safe negative space exists for every planned bubble. When regenerating, return the matching issue values and an empty placements array.
- Set artwork to "clean" only when the image contains artwork alone and every planned bubble has legitimate negative space. For clean artwork, issues must be empty and placements must contain every dialogue index.
- For every visibly staged actor, return its full body bounds, face center, and a speechAnchor in nearby empty background. All are full-panel percentages. Never invent an actor that is not listed.
- Return every dialogue index exactly once and no extra indices.
- Read the actual pixels to identify where each named speaker is drawn; do not trust speaking order.
- Put the bubble above or beside that speaker and choose side from the speaker's actual position.
- Keep bubbles out of the bottom 20% reserved for captions.
- Keep every bubble fully inside the panel, non-overlapping, and in natural left-to-right/top-to-bottom reading order.
- Favor natural horizontal bubbles, never narrow vertical columns. Words must wrap only at spaces and must never split in the middle.
- Size bubbles to their actual text instead of making every bubble alike: width 20-26 for very short lines, 26-34 for ordinary lines, 30-40 for medium lines, and 34-44 for long lines. If two valid placements are possible, choose the one with fewer text lines and more breathing room.
- The full bubble rectangle and tail must sit in negative space. Never cover or touch any character's head, face, hair, body, hands, or important prop.

${comicDirectorGuidance('lettering', { panel })}`;
}

export function buildPanelReviewPrompt({ panel }) {
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : [])
    .slice(0, 2)
    .map((line, index) => `${index}. ${cleanText(line?.speaker, 80) || 'Unattributed'}: ${cleanText(line?.line, 300)}`)
    .join('\n');
  return `You are Nex's final comic letterer. You receive two pixel-accurate phone renders of the same panel. IMAGE 1 is the clean displayed artwork before bubbles. IMAGE 2 is the finished mobile panel with the app's bubbles at their real size. Compare them like a human art director.

DIALOGUE INDEXES
${dialogue || 'No dialogue.'}

Return ONLY JSON:
{"verdict":"pass|corrected","placements":[{"index":0,"side":"left|right","x":number,"y":number,"width":number}]}

- Return every dialogue index exactly once. Coordinates are percentages of this full preview; x/y are top-left and width is bubble width.
- Use verdict "pass" only when every bubble is naturally placed beside its speaker, the tail points clearly, reading order is obvious, sizes vary with the amount of text, and the art remains easy to see.
- Use verdict "corrected" and return better coordinates if ANY bubble overlaps or touches a head, face, hair, body, hand, prop, monster, focal action, caption, or another bubble.
- Before deciding, identify the complete silhouette of every face, head, body, hand, prop, creature, and focal action in the pixels. Require visible background clearance around them; a face partly hidden behind a bubble is an automatic failure.
- Use IMAGE 1 to recover every face, head, hand, and prop boundary that a bubble hides in IMAGE 2. Never assume covered pixels are empty.
- A correction must move the complete bubble rectangle into genuinely empty background. Do not make a small nudge that leaves it over the same person or action.
- Never put a bubble directly over its speaker. Put it in adjacent empty background and use the tail to connect it.
- Keep bubbles above the caption zone, completely inside the panel, and comfortably separated from edges.
- Size to the text: 20-26 very short, 26-34 ordinary, 30-40 medium, 34-44 long. Favor compact natural shapes, not identical boxes or tall narrow columns.

${comicDirectorGuidance('qa', { panel })}`;
}

function gatewayText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('');
}

const ARTWORK_ISSUES = new Set(['generated_text', 'blank_lettering_box', 'no_safe_lettering_space']);

function parseActorInspection(value, panel) {
  const allowed = new Set((Array.isArray(panel?.scene?.actors) ? panel.scene.actors : [])
    .map((actor) => cleanText(actor.id || actor.actorId || actor.characterId, 64))
    .filter(Boolean));
  if (!allowed.size) return [];
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((candidate) => {
    const id = cleanText(candidate?.actorId, 64);
    if (!allowed.has(id) || seen.has(id)) return [];
    const bounds = candidate?.bounds || {};
    const face = candidate?.faceAnchor || {};
    const speech = candidate?.speechAnchor || {};
    const numbers = [bounds.x,bounds.y,bounds.width,bounds.height,face.x,face.y,speech.x,speech.y].map(Number);
    if (!numbers.every(Number.isFinite)) return [];
    seen.add(id);
    return [{
      actorId:id,
      bounds:{
        x:Math.max(-20,Math.min(120,numbers[0])),
        y:Math.max(-20,Math.min(120,numbers[1])),
        width:Math.max(1,Math.min(140,numbers[2])),
        height:Math.max(1,Math.min(140,numbers[3])),
      },
      faceAnchor:{x:Math.max(-20,Math.min(120,numbers[4])),y:Math.max(-20,Math.min(120,numbers[5]))},
      speechAnchor:{x:Math.max(-20,Math.min(120,numbers[6])),y:Math.max(-20,Math.min(120,numbers[7]))},
    }];
  });
}

function jsonObject(raw) {
  const cleaned = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch { return null; }
}

function bubbleHeight(line, width) {
  const charactersPerLine = Math.max(10, Math.floor(width * 0.68));
  const words = cleanText(line?.line, 500).split(/\s+/u).filter(Boolean);
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const next = used ? used + 1 + word.length : word.length;
    if (used && next > charactersPerLine) { lines += 1; used = word.length; }
    else used = next;
  }
  return Math.min(34, 9 + lines * 5 + (line?.speaker ? 4 : 0));
}

function overlaps(a, b) {
  const margin = 1.5;
  return !(
    a.x + a.width + margin <= b.x
    || b.x + b.width + margin <= a.x
    || a.y + a.height + margin <= b.y
    || b.y + b.height + margin <= a.y
  );
}

export function parseBubblePlacements(raw, dialogue) {
  const lines = (Array.isArray(dialogue) ? dialogue : []).slice(0, 2);
  if (!lines.length) return [];
  const cleaned = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); }
  catch { return null; }
  if (!Array.isArray(parsed?.placements) || parsed.placements.length !== lines.length) return null;

  const placements = [];
  const seen = new Set();
  for (const candidate of parsed.placements) {
    const index = Number(candidate?.index);
    if (!Number.isInteger(index) || index < 0 || index >= lines.length || seen.has(index)) return null;
    seen.add(index);
    const { min:minWidth, max:maxWidth } = bubbleWidthRange(lines[index]);
    const requestedWidth = Number(candidate?.width);
    const requestedX = Number(candidate?.x);
    const requestedY = Number(candidate?.y);
    if (![requestedWidth, requestedX, requestedY].every(Number.isFinite)) return null;
    if (!['left', 'right'].includes(candidate?.side)) return null;
    const width = Math.max(minWidth, Math.min(maxWidth, requestedWidth));
    const height = bubbleHeight(lines[index], width);
    const x = Math.max(2, Math.min(98 - width, requestedX));
    const y = Math.max(3, Math.min(78 - height, requestedY));
    placements.push({
      index,
      side: candidate.side,
      layout: {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        width: Math.round(width * 10) / 10,
        source: 'vision',
      },
      height,
    });
  }
  placements.sort((a, b) => a.index - b.index);
  for (let index = 0; index < placements.length; index += 1) {
    const current = { ...placements[index].layout, height:placements[index].height };
    if (placements.slice(0, index).some((prior) => overlaps(current, { ...prior.layout, height:prior.height }))) return null;
  }
  return placements.map(({ height, ...placement }) => placement);
}

export function parsePanelVisualInspection(raw, dialogue, panel = null) {
  const parsed = jsonObject(raw);
  if (!parsed || !['clean', 'regenerate'].includes(parsed.artwork)) return null;
  const issues = Array.isArray(parsed.issues) ? [...new Set(parsed.issues.filter((issue) => ARTWORK_ISSUES.has(issue)))] : [];
  if (parsed.artwork === 'regenerate') {
    if (!issues.length) return null;
    return { artwork:'regenerate', issues, actors:[], placements:[] };
  }
  if (issues.length) return null;
  const placements = parseBubblePlacements(JSON.stringify({placements:parsed.placements}), dialogue);
  if (!placements && (Array.isArray(dialogue) ? dialogue : []).some((line) => line?.line)) return null;
  return { artwork:'clean', issues:[], actors:parseActorInspection(parsed.actors, panel), placements:placements || [] };
}

export function parseLetteringReview(raw, dialogue) {
  const cleaned = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); }
  catch { return null; }
  if (!['pass', 'corrected'].includes(parsed?.verdict)) return null;
  const placements = parseBubblePlacements(JSON.stringify({placements:parsed.placements}), dialogue);
  return placements ? { verdict:parsed.verdict, placements } : null;
}

export async function reviewPanelLettering({
  panel,
  cleanPreviewDataUrl,
  previewDataUrl,
  userId = '',
  env = process.env,
  fetchFn = fetch,
} = {}) {
  if (!env.AI_GATEWAY_API_KEY) throw new Error('Story Studio lettering review is not configured');
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : []).filter((line) => line?.line).slice(0, 2);
  if (!dialogue.length) return { verdict:'pass', placements:[] };
  parseImageDataUrl(cleanPreviewDataUrl);
  parseImageDataUrl(previewDataUrl);
  const controller = new AbortController();
  const timeoutMs = Math.max(8_000, Math.min(Number(env.STORY_STUDIO_VISION_TIMEOUT_MS) || 20_000, 30_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const model = env.STORY_STUDIO_VISION_MODEL || env.NEX_GATEWAY_STANDARD_MODEL || DEFAULT_STORY_VISION_MODEL;
    const response = await fetchFn(GATEWAY_IMAGE_ENDPOINT, {
      method:'POST',
      headers:{Authorization:`Bearer ${env.AI_GATEWAY_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model,
        messages:[{role:'user',content:[
          {type:'text',text:buildPanelReviewPrompt({panel})},
          {type:'text',text:'IMAGE 1 — clean phone-rendered panel without bubbles'},
          {type:'image_url',image_url:{url:cleanPreviewDataUrl}},
          {type:'text',text:'IMAGE 2 — the same phone-rendered panel with final bubbles'},
          {type:'image_url',image_url:{url:previewDataUrl}},
        ]}],
        max_tokens:800,
        temperature:0,
        providerOptions:{gateway:{
          ...(userId ? {user:String(userId).slice(0,120)} : {}),
          tags:['feature:story-studio-lettering-review'],
        }},
        stream:false,
      }),
      signal:controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Story Studio lettering reviewer returned HTTP ${response.status}`);
    const review = parseLetteringReview(gatewayText(data), dialogue);
    if (!review) throw new Error('Story Studio lettering reviewer returned an unusable review');
    return review;
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectPanelVisual({
  panel,
  imageDataUrl,
  userId = '',
  env = process.env,
  fetchFn = fetch,
} = {}) {
  if (!env.AI_GATEWAY_API_KEY) throw new Error('Story Studio vision is not configured');
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : []).filter((line) => line?.line).slice(0, 2);
  parseImageDataUrl(imageDataUrl);
  const controller = new AbortController();
  const timeoutMs = Math.max(8_000, Math.min(Number(env.STORY_STUDIO_VISION_TIMEOUT_MS) || 20_000, 30_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const model = env.STORY_STUDIO_VISION_MODEL || env.NEX_GATEWAY_STANDARD_MODEL || DEFAULT_STORY_VISION_MODEL;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const correction = attempt
        ? '\n\nYour first layout was rejected because it was cramped, overlapping, incomplete, or out of bounds. Reinspect the pixels and return a wider, cleaner, fully valid layout.'
        : '';
      const response = await fetchFn(GATEWAY_IMAGE_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type:'text', text:buildPanelVisionPrompt({panel}) + correction },
              { type:'image_url', image_url:{url:imageDataUrl} },
            ],
          }],
          max_tokens: 800,
          temperature: 0,
          providerOptions: {
            gateway: {
              ...(userId ? {user:String(userId).slice(0,120)} : {}),
              tags: ['feature:story-studio-vision'],
            },
          },
          stream: false,
        }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (attempt === 0) continue;
        throw new Error(`Story Studio vision provider returned HTTP ${response.status}`);
      }
      const inspection = parsePanelVisualInspection(gatewayText(data), dialogue, panel);
      if (inspection) return inspection;
    }
    throw new Error('Story Studio vision returned unusable bubble positions');
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzePanelVisual(options = {}) {
  const inspection = await inspectPanelVisual(options);
  if (inspection.artwork !== 'clean') {
    throw new Error(`Story Studio artwork needs regeneration: ${inspection.issues.join(', ')}`);
  }
  return inspection.placements;
}

function imageFromGateway(data) {
  const images = data?.choices?.[0]?.message?.images;
  const url = Array.isArray(images) ? images[0]?.image_url?.url : null;
  parseImageDataUrl(url);
  return url;
}

function imageFromImageEndpoint(data) {
  const base64 = data?.data?.[0]?.b64_json;
  return parseImageDataUrl(`data:image/png;base64,${String(base64 || '')}`);
}

async function gatewayImageRequest({ endpoint, body, env, fetchFn, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(endpoint, {
      method:'POST',
      headers:{Authorization:`Bearer ${env.AI_GATEWAY_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),
      signal:controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Story Studio art department request rejected', response.status);
      throw new Error(`Story Studio art department returned HTTP ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateBackgroundPlate({
  comic,
  panel,
  panelIndex,
  correctionIssues = [],
  userId = '',
  env = process.env,
  fetchFn = fetch,
} = {}) {
  if (!env.AI_GATEWAY_API_KEY) throw new Error('Story Studio image generation is not configured');
  if (!validPanelIndex(panelIndex)) throw new Error('Invalid Story Studio panel');
  const corrections = (Array.isArray(correctionIssues) ? correctionIssues : []).map((issue) => ({
    generated_text:'The prior set plate contained text-like marks. Remove every word, letter, numeral, sign, label, and symbol.',
    blank_lettering_box:'The prior set plate contained a blank box or balloon. Remove it and restore natural scenery.',
    no_safe_lettering_space:'Simplify the background around actor blocking so the stage can add readable dialogue later.',
  }[issue])).filter(Boolean);
  const generationId = randomUUID();
  const model = env.STORY_STUDIO_IMAGE_MODEL || DEFAULT_STORY_IMAGE_MODEL;
  const prompt = `${buildBackgroundPlatePrompt({comic,panel})}${corrections.length ? `\n\nRETRY NOTES\n${corrections.join('\n')}` : ''}`;
  const timeoutMs = Math.max(15_000, Math.min(Number(env.STORY_STUDIO_IMAGE_TIMEOUT_MS) || 90_000, 120_000));
  const data = await gatewayImageRequest({
    endpoint:GATEWAY_IMAGE_ENDPOINT,
    env,fetchFn,timeoutMs,
    body:{
      model,
      messages:[{role:'user',content:prompt}],
      modalities:['text','image'],
      providerOptions:{gateway:{
        ...(userId ? {user:String(userId).slice(0,120)} : {}),
        tags:['feature:story-studio-background','asset:background-plate'],
      }},
      stream:false,
    },
  });
  return {dataUrl:imageFromGateway(data),model,usage:data?.usage || null,kind:'background',generationId};
}

export async function generateActorVisual({
  comic,
  panel = null,
  actor = null,
  character,
  referenceImage = null,
  userId = '',
  env = process.env,
  fetchFn = fetch,
} = {}) {
  if (!env.AI_GATEWAY_API_KEY) throw new Error('Story Studio actor generation is not configured');
  const generationId = randomUUID();
  const model = env.STORY_STUDIO_ACTOR_IMAGE_MODEL || DEFAULT_STORY_ACTOR_IMAGE_MODEL;
  const hasIdentity = Boolean(referenceImage?.mediaType && referenceImage?.base64);
  const identity = !panel;
  const prompt = identity
    ? buildCharacterIdentityPrompt({comic,character})
    : buildActorPerformancePrompt({comic,panel,actor,character,hasIdentity});
  const endpoint = hasIdentity ? GATEWAY_IMAGE_EDIT_ENDPOINT : GATEWAY_IMAGE_GENERATION_ENDPOINT;
  const timeoutMs = Math.max(15_000, Math.min(Number(env.STORY_STUDIO_ACTOR_TIMEOUT_MS) || 90_000, 120_000));
  const body = {
    model,
    prompt,
    size:'1024x1536',
    quality:'medium',
    background:'transparent',
    output_format:'png',
    response_format:'b64_json',
    providerOptions:{gateway:{
      ...(userId ? {user:String(userId).slice(0,120)} : {}),
      tags:[identity ? 'feature:story-studio-cast' : 'feature:story-studio-actor-layer',identity ? 'asset:character-identity' : 'asset:actor-performance'],
    }},
    ...(hasIdentity ? {images:[{image_url:`data:${referenceImage.mediaType};base64,${referenceImage.base64}`}]} : {}),
  };
  const data = await gatewayImageRequest({endpoint,body,env,fetchFn,timeoutMs});
  const parsed = imageFromImageEndpoint(data);
  return {
    dataUrl:`data:${parsed.mediaType};base64,${parsed.base64}`,
    model,
    usage:data?.usage || null,
    kind:identity ? 'identity' : 'actor',
    generationId,
  };
}

export async function generatePanelVisual({
  comic,
  panel,
  panelIndex,
  referenceImage = null,
  correctionIssues = [],
  env = process.env,
  fetchFn = fetch,
} = {}) {
  if (!env.AI_GATEWAY_API_KEY) throw new Error('Story Studio image generation is not configured');
  if (!validPanelIndex(panelIndex)) throw new Error('Invalid Story Studio panel');

  const referenceUrl = referenceImage
    ? `data:${referenceImage.mediaType};base64,${referenceImage.base64}`
    : null;
  const correctionRules = (Array.isArray(correctionIssues) ? correctionIssues : []).map((issue) => ({
    generated_text:'The prior attempt contained accidental printed characters. Produce pure artwork with absolutely no text-like marks or boxes.',
    blank_lettering_box:'The prior attempt drew blank lettering boxes. Recompose with natural background space and no rectangles, balloons, or placeholders.',
    no_safe_lettering_space:'The prior attempt left no clear space for dialogue. Recompose the people and action so calm background remains beside the speakers.',
  }[issue])).filter(Boolean);
  const prompt = `${buildPanelVisualPrompt({ comic, panel, panelIndex, hasReference: Boolean(referenceUrl) })}${correctionRules.length ? `\n\nRETRY CORRECTION\n${correctionRules.join('\n')}` : ''}`;
  const content = referenceUrl
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: referenceUrl } },
      ]
    : prompt;
  const controller = new AbortController();
  const timeoutMs = Math.max(15_000, Math.min(Number(env.STORY_STUDIO_IMAGE_TIMEOUT_MS) || 90_000, 120_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const model = env.STORY_STUDIO_IMAGE_MODEL || DEFAULT_STORY_IMAGE_MODEL;
    const response = await fetchFn(GATEWAY_IMAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        modalities: ['text', 'image'],
        stream: false,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Story Studio image provider rejected request', response.status);
      throw new Error(`Story Studio image provider returned HTTP ${response.status}`);
    }
    return { dataUrl: imageFromGateway(data), model };
  } finally {
    clearTimeout(timer);
  }
}

async function defaultRedisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Story Studio visual ${command[0]} failed`);
  return data.result;
}

export function createStoryVisualStore({ command = defaultRedisCommand, now = () => Date.now() } = {}) {
  async function saveAsset(key, { dataUrl, model, usage = null, kind = '', generationId = '' } = {}) {
    const parsed = parseImageDataUrl(dataUrl);
    const asset = {
      mediaType: parsed.mediaType,
      base64: parsed.base64,
      model: cleanText(model, 160),
      kind:cleanText(kind, 40),
      generationId:cleanText(generationId, 80) || randomUUID(),
      usage:usage && typeof usage === 'object' ? usage : null,
      generatedAt: now(),
    };
    await command(['SET', key, JSON.stringify(asset)]);
    return asset;
  }

  async function getAsset(key) {
    const raw = await command(['GET', key]);
    if (!raw) return null;
    try {
      const asset = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!MEDIA_TYPES.has(asset?.mediaType) || !asset?.base64) return null;
      return asset;
    } catch {
      return null;
    }
  }

  async function save(userId, projectId, panelIndex, input = {}) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || '')) || !validPanelIndex(panelIndex)) {
      throw new Error('Invalid Story Studio visual owner');
    }
    return saveAsset(assetKey(userId, projectId, panelIndex), {...input,kind:'background'});
  }

  async function get(userId, projectId, panelIndex) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || '')) || !validPanelIndex(panelIndex)) return null;
    return getAsset(assetKey(userId, projectId, panelIndex));
  }

  async function saveIdentity(userId, projectId, actor, input = {}) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || '')) || !validActorId(actor)) throw new Error('Invalid Story Studio identity owner');
    return saveAsset(identityAssetKey(userId, projectId, actor), {...input,kind:'identity'});
  }

  async function getIdentity(userId, projectId, actor) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || '')) || !validActorId(actor)) return null;
    return getAsset(identityAssetKey(userId, projectId, actor));
  }

  async function saveActor(userId, projectId, panelIndex, actor, input = {}) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || '')) || !validPanelIndex(panelIndex) || !validActorId(actor)) {
      throw new Error('Invalid Story Studio actor asset owner');
    }
    return saveAsset(actorAssetKey(userId, projectId, panelIndex, actor), {...input,kind:'actor'});
  }

  async function getActor(userId, projectId, panelIndex, actor) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || '')) || !validPanelIndex(panelIndex) || !validActorId(actor)) return null;
    return getAsset(actorAssetKey(userId, projectId, panelIndex, actor));
  }

  async function deleteProject(userId, projectId, comic = null) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || ''))) return 0;
    const actorIds = (Array.isArray(comic?.characters) ? comic.characters : [])
      .map((character) => cleanText(character?.actorId, 64))
      .filter(validActorId);
    const keys = [
      ...Array.from({length:PANEL_LIMIT},(_,index) => assetKey(userId,projectId,index)),
      ...actorIds.map((actor) => identityAssetKey(userId,projectId,actor)),
      ...Array.from({length:PANEL_LIMIT},(_,index) => actorIds.map((actor) => actorAssetKey(userId,projectId,index,actor))).flat(),
    ];
    return Number(await command(['DEL', ...keys])) || 0;
  }

  return { save, get, saveIdentity, getIdentity, saveActor, getActor, deleteProject };
}

export const storyVisualStore = createStoryVisualStore();
export const __internals = {
  ARTWORK_ISSUES,
  GATEWAY_IMAGE_ENDPOINT,
  GATEWAY_IMAGE_GENERATION_ENDPOINT,
  GATEWAY_IMAGE_EDIT_ENDPOINT,
  MAX_IMAGE_BYTES,
  PANEL_LIMIT,
  assetKey,
  actorAssetKey,
  identityAssetKey,
  bubbleHeight,
};
