// Authenticated delivery for persisted Story Studio panel art. Generated
// images never receive a public storage URL that another customer can guess.

import { getRequestUser } from '../lib/roomAuth.js';
import { storyStudioStore } from '../lib/storyStudio.js';
import { storyVisualStore } from '../lib/storyVisuals.js';

const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;

export function createStoryImageHandler({
  resolveUser = getRequestUser,
  projectStore = storyStudioStore,
  visualStore = storyVisualStore,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const username = await resolveUser(req).catch(() => null);
    if (!username) return res.status(401).json({ error: 'Sign in required' });
    const projectId = String(req.query?.id || '');
    const panelIndex = Number(req.query?.panel);
    if (!PROJECT_ID_RE.test(projectId) || !Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex > 7) {
      return res.status(400).json({ error: 'Invalid Story Studio image' });
    }
    if (!await projectStore.getProject(username, projectId)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    const asset = await visualStore.get(username, projectId, panelIndex);
    if (!asset) return res.status(404).json({ error: 'Image not found' });

    const bytes = Buffer.from(asset.base64, 'base64');
    res.setHeader('Content-Type', asset.mediaType);
    res.setHeader('Content-Length', String(bytes.length));
    return res.status(200).send(bytes);
  };
}

export default createStoryImageHandler();
