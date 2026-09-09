// Story Studio visual engine: turn one continuity-aware panel plan into real
// generated art, then persist the image privately per customer and project.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export const DEFAULT_STORY_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
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
    ? panel.dialogue.map((line) => `${cleanText(line?.speaker, 80)}: ${cleanText(line?.line, 300)}`).join(' | ')
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
${hasReference ? '- Use the supplied reference panel only to preserve the character designs, palette, and art style. Create a genuinely new composition; do not copy its pose or background.' : '- Establish the canonical character designs and visual language that later panels can follow.'}
- Do not include captions, speech bubbles, logos, signatures, borders, watermarks, or readable text. The app adds dialogue separately.
- Use original commercial-safe visual language and never imitate a named living artist.`;
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
export const __internals = { GATEWAY_IMAGE_ENDPOINT, MAX_IMAGE_BYTES, PANEL_LIMIT, assetKey };
