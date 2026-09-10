// Story Studio visual engine: turn one continuity-aware panel plan into real
// generated art, then persist the image privately per customer and project.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export const DEFAULT_STORY_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
export const DEFAULT_STORY_VISION_MODEL = 'openai/gpt-5.4';
const GATEWAY_IMAGE_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PANEL_LIMIT = 8;
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function encodeKey(value) {
  return encodeURIComponent(String(value));
}

function assetKey(userId, projectId, panelIndex) {
  return `nexus:story-studio:visual:${encodeKey(userId)}:${encodeKey(projectId)}:${panelIndex}`;
}

function validPanelIndex(value) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < PANEL_LIMIT;
}

function cleanText(value, max = 1_000) {
  return String(value || '').trim().slice(0, max);
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
  return lines.map((line, index) => {
    const side = line?.side === 'right' ? 'right' : 'left';
    const width = bubbleWidthRange(line).min;
    const x = side === 'right' ? 94 - width : 6;
    const y = 13 + sideCounts[side] * 25;
    sideCounts[side] += 1;
    return `${index + 1}. ${cleanText(line?.speaker, 80) || 'Speaker'}: keep the ${side} zone x=${x}-${x + width}%, y=${y}-${Math.min(68, y + 22)}% visually quiet for a ${width}%-wide bubble.`;
  }).join('\n');
}

export function buildPanelVisualPrompt({ comic, panel, panelIndex, hasReference = false }) {
  const palette = Array.isArray(comic?.palette) ? comic.palette.join(', ') : '';
  const dialogue = Array.isArray(panel?.dialogue)
    ? panel.dialogue.slice(0, 2).map((line) => `${cleanText(line?.speaker, 80)} (${line?.side === 'right' ? 'right' : 'left'} side): ${cleanText(line?.line, 300)}`).join(' | ')
    : '';
  const reservations = buildBubbleReservations(panel?.dialogue);
  return `Create finished comic-book artwork for panel ${Number(panelIndex) + 1} of ${comic?.panels?.length || 6}.

STORY WORLD
Title: ${cleanText(comic?.title, 120)}
Genre: ${cleanText(comic?.genre, 100)}
Visual style: ${cleanText(comic?.visualStyle, 300)}
Palette: ${cleanText(palette, 160)}

LOCKED CHARACTER BIBLE
${characterBible(comic) || 'No recurring named character is required in this panel.'}

THIS PANEL ONLY
Story beat: ${cleanText(panel?.beat, 700)}
Camera: ${cleanText(panel?.shot, 200)}
Setting: ${cleanText(panel?.setting, 300)}
Art direction: ${cleanText(panel?.artDirection, 1_200)}
Dialogue context (do not draw words): ${cleanText(dialogue, 500)}

LETTERING RESERVATIONS
${reservations || 'No dialogue bubbles are planned; prioritize the clearest dramatic composition.'}

RENDER RULES
- Produce one full-bleed landscape comic panel, not a page layout, collage, character sheet, or repeated template.
- Make this scene, action, camera angle, silhouettes, and environment unmistakably specific to this story beat.
- Keep every recurring character's face, body, hair, clothing, colors, and props consistent with the locked bible.
- Treat every LETTERING RESERVATION as locked composition space. Place the named speaker close enough that a bubble tail can point naturally, but keep faces, hands, important props, strong highlights, and the main action outside that rectangle.
- Keep reserved areas calm and low-detail. Do not fill them with faces or essential scenery, and do not draw the bubble or words yourself.
${hasReference ? '- Use the supplied reference panel only to preserve the character designs, palette, and art style. Create a genuinely new composition; do not copy its pose or background.' : '- Establish the canonical character designs and visual language that later panels can follow.'}
- Do not include captions, speech bubbles, logos, signatures, borders, watermarks, or readable text. The app adds dialogue separately.
- Use original commercial-safe visual language and never imitate a named living artist.`;
}

export function buildPanelVisionPrompt({ panel }) {
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : [])
    .slice(0, 2)
    .map((line, index) => `${index}. ${cleanText(line?.speaker, 80) || 'Unattributed'} [${cleanText(line?.type, 20) || 'speech'}]: ${cleanText(line?.line, 300)}`)
    .join('\n');
  return `Inspect this finished comic panel like a professional letterer. Place one bubble for every numbered dialogue line in visually empty space near its actual speaker while protecting faces, hands, important props, and the main action.

DIALOGUE IN READING ORDER
${dialogue || 'No dialogue.'}

Return ONLY JSON with this shape:
{"placements":[{"index":0,"side":"left|right","x":number,"y":number,"width":number}]}

Coordinates are percentages of the full panel. x/y are the bubble's top-left corner. width is the bubble width.
- Return every dialogue index exactly once and no extra indices.
- Read the actual pixels to identify where each named speaker is drawn; do not trust speaking order.
- Put the bubble above or beside that speaker and choose side from the speaker's actual position.
- Keep bubbles out of the bottom 20% reserved for captions and away from the tiny panel number at the top edge.
- Keep every bubble fully inside the panel, non-overlapping, and in natural left-to-right/top-to-bottom reading order.
- Favor natural horizontal bubbles, never narrow vertical columns. Words must wrap only at spaces and must never split in the middle.
- Size bubbles to their actual text instead of making every bubble alike: width 20-26 for very short lines, 26-34 for ordinary lines, 30-40 for medium lines, and 34-44 for long lines. If two valid placements are possible, choose the one with fewer text lines and more breathing room.
- The full bubble rectangle and tail must sit in negative space. Never cover or touch any character's head, face, hair, body, hands, or important prop.`;
}

export function buildPanelReviewPrompt({ panel }) {
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : [])
    .slice(0, 2)
    .map((line, index) => `${index}. ${cleanText(line?.speaker, 80) || 'Unattributed'}: ${cleanText(line?.line, 300)}`)
    .join('\n');
  return `You are Nex's final comic letterer. This image is the ACTUAL finished mobile panel with the app's bubbles already rendered at their real size. Review what is visibly on screen like a human art director.

DIALOGUE INDEXES
${dialogue || 'No dialogue.'}

Return ONLY JSON:
{"verdict":"pass|corrected","placements":[{"index":0,"side":"left|right","x":number,"y":number,"width":number}]}

- Return every dialogue index exactly once. Coordinates are percentages of this full preview; x/y are top-left and width is bubble width.
- Use verdict "pass" only when every bubble is naturally placed beside its speaker, the tail points clearly, reading order is obvious, sizes vary with the amount of text, and the art remains easy to see.
- Use verdict "corrected" and return better coordinates if ANY bubble overlaps or touches a head, face, hair, body, hand, prop, monster, focal action, caption, panel number, or another bubble.
- Never put a bubble directly over its speaker. Put it in adjacent empty background and use the tail to connect it.
- Keep bubbles above the caption zone, completely inside the panel, and comfortably separated from edges.
- Size to the text: 20-26 very short, 26-34 ordinary, 30-40 medium, 34-44 long. Favor compact natural shapes, not identical boxes or tall narrow columns.`;
}

function gatewayText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('');
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
  previewDataUrl,
  userId = '',
  env = process.env,
  fetchFn = fetch,
} = {}) {
  if (!env.AI_GATEWAY_API_KEY) throw new Error('Story Studio lettering review is not configured');
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : []).filter((line) => line?.line).slice(0, 2);
  if (!dialogue.length) return { verdict:'pass', placements:[] };
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

export async function analyzePanelVisual({
  panel,
  imageDataUrl,
  userId = '',
  env = process.env,
  fetchFn = fetch,
} = {}) {
  if (!env.AI_GATEWAY_API_KEY) throw new Error('Story Studio vision is not configured');
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : []).filter((line) => line?.line).slice(0, 2);
  if (!dialogue.length) return [];
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
      const placements = parseBubblePlacements(gatewayText(data), dialogue);
      if (placements) return placements;
    }
    throw new Error('Story Studio vision returned unusable bubble positions');
  } finally {
    clearTimeout(timer);
  }
}

function imageFromGateway(data) {
  const images = data?.choices?.[0]?.message?.images;
  const url = Array.isArray(images) ? images[0]?.image_url?.url : null;
  parseImageDataUrl(url);
  return url;
}

export async function generatePanelVisual({
  comic,
  panel,
  panelIndex,
  referenceImage = null,
  env = process.env,
  fetchFn = fetch,
} = {}) {
  if (!env.AI_GATEWAY_API_KEY) throw new Error('Story Studio image generation is not configured');
  if (!validPanelIndex(panelIndex)) throw new Error('Invalid Story Studio panel');

  const referenceUrl = referenceImage
    ? `data:${referenceImage.mediaType};base64,${referenceImage.base64}`
    : null;
  const prompt = buildPanelVisualPrompt({ comic, panel, panelIndex, hasReference: Boolean(referenceUrl) });
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
  async function save(userId, projectId, panelIndex, { dataUrl, model } = {}) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || '')) || !validPanelIndex(panelIndex)) {
      throw new Error('Invalid Story Studio visual owner');
    }
    const parsed = parseImageDataUrl(dataUrl);
    const asset = {
      mediaType: parsed.mediaType,
      base64: parsed.base64,
      model: cleanText(model, 160),
      generatedAt: now(),
    };
    await command(['SET', assetKey(userId, projectId, panelIndex), JSON.stringify(asset)]);
    return asset;
  }

  async function get(userId, projectId, panelIndex) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || '')) || !validPanelIndex(panelIndex)) return null;
    const raw = await command(['GET', assetKey(userId, projectId, panelIndex)]);
    if (!raw) return null;
    try {
      const asset = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!MEDIA_TYPES.has(asset?.mediaType) || !asset?.base64) return null;
      return asset;
    } catch {
      return null;
    }
  }

  async function deleteProject(userId, projectId) {
    if (!userId || !PROJECT_ID_RE.test(String(projectId || ''))) return 0;
    const keys = Array.from({ length: PANEL_LIMIT }, (_, index) => assetKey(userId, projectId, index));
    return Number(await command(['DEL', ...keys])) || 0;
  }

  return { save, get, deleteProject };
}

export const storyVisualStore = createStoryVisualStore();
export const __internals = { GATEWAY_IMAGE_ENDPOINT, MAX_IMAGE_BYTES, PANEL_LIMIT, assetKey, bubbleHeight };
