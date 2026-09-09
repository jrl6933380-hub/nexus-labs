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

export function buildPanelVisualPrompt({ comic, panel, panelIndex, hasReference = false }) {
  const palette = Array.isArray(comic?.palette) ? comic.palette.join(', ') : '';
  const dialogue = Array.isArray(panel?.dialogue)
    ? panel.dialogue.map((line) => `${cleanText(line?.speaker, 80)} (${line?.side === 'right' ? 'right' : line?.side === 'left' ? 'left' : 'auto'} side): ${cleanText(line?.line, 300)}`).join(' | ')
    : '';
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

RENDER RULES
- Produce one full-bleed landscape comic panel, not a page layout, collage, character sheet, or repeated template.
- Make this scene, action, camera angle, silhouettes, and environment unmistakably specific to this story beat.
- Keep every recurring character's face, body, hair, clothing, colors, and props consistent with the locked bible.
- When Dialogue context names a left or right side, compose that speaking character on that side. For auto, choose the clearest composition. Keep negative space above or beside every speaker for the app's bubble, without drawing the bubble or words yourself.
${hasReference ? '- Use the supplied reference panel only to preserve the character designs, palette, and art style. Create a genuinely new composition; do not copy its pose or background.' : '- Establish the canonical character designs and visual language that later panels can follow.'}
- Do not include captions, speech bubbles, logos, signatures, borders, watermarks, or readable text. The app adds dialogue separately.
- Use original commercial-safe visual language and never imitate a named living artist.`;
}

export function buildPanelVisionPrompt({ panel }) {
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : [])
    .slice(0, 6)
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
- Use width 16-28 for short lines, 24-38 for medium lines, and 32-46 for long lines.`;
}

function gatewayText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('');
}

function bubbleHeight(line, width) {
  const charactersPerLine = Math.max(12, Math.round(width * 0.8));
  const lines = Math.max(1, Math.ceil(cleanText(line?.line, 500).length / charactersPerLine));
  return Math.min(30, 8 + lines * 4.5 + (line?.speaker ? 3 : 0));
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
  const lines = (Array.isArray(dialogue) ? dialogue : []).slice(0, 6);
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
    const length = cleanText(lines[index]?.line, 500).length;
    const minWidth = length <= 40 ? 16 : length <= 90 ? 24 : 32;
    const maxWidth = length <= 40 ? 28 : length <= 90 ? 38 : 46;
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

export async function analyzePanelVisual({
  panel,
  imageDataUrl,
  userId = '',
  env = process.env,
  fetchFn = fetch,
} = {}) {
  if (!env.AI_GATEWAY_API_KEY) throw new Error('Story Studio vision is not configured');
  const dialogue = (Array.isArray(panel?.dialogue) ? panel.dialogue : []).filter((line) => line?.line).slice(0, 6);
  if (!dialogue.length) return [];
  parseImageDataUrl(imageDataUrl);
  const controller = new AbortController();
  const timeoutMs = Math.max(8_000, Math.min(Number(env.STORY_STUDIO_VISION_TIMEOUT_MS) || 20_000, 30_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const model = env.STORY_STUDIO_VISION_MODEL || env.NEX_GATEWAY_STANDARD_MODEL || DEFAULT_STORY_VISION_MODEL;
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
            { type:'text', text:buildPanelVisionPrompt({panel}) },
            { type:'image_url', image_url:{url:imageDataUrl} },
          ],
        }],
        max_tokens: 800,
        temperature: 0,
        providerOptions: {
          gateway: {
            models: [env.STORY_STUDIO_IMAGE_MODEL || DEFAULT_STORY_IMAGE_MODEL],
            ...(userId ? {user:String(userId).slice(0,120)} : {}),
            tags: ['feature:story-studio-vision'],
          },
        },
        stream: false,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Story Studio vision provider returned HTTP ${response.status}`);
    const placements = parseBubblePlacements(gatewayText(data), dialogue);
    if (!placements) throw new Error('Story Studio vision returned unusable bubble positions');
    return placements;
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
