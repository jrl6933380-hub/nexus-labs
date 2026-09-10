// Private delivery for Story Studio's reusable character identities and
// panel-specific transparent performance layers.

import { getRequestUser } from '../lib/roomAuth.js';
import { storyStudioStore } from '../lib/storyStudio.js';
import { storyVisualStore } from '../lib/storyVisuals.js';

const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const ACTOR_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function createStoryActorHandler({
  resolveUser = getRequestUser,
  projectStore = storyStudioStore,
  visualStore = storyVisualStore,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control','private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options','nosniff');
    if (req.method !== 'GET') return res.status(405).json({error:'Method Not Allowed'});

    const username = await resolveUser(req).catch(() => null);
    if (!username) return res.status(401).json({error:'Sign in required'});
    const projectId = String(req.query?.id || '');
    const actor = String(req.query?.actor || '');
    const kind = String(req.query?.kind || 'performance');
    const panelIndex = Number(req.query?.panel);
    if (!PROJECT_ID_RE.test(projectId) || !ACTOR_ID_RE.test(actor) || !['identity','performance'].includes(kind)) {
      return res.status(400).json({error:'Invalid Story Studio actor image'});
    }
    if (kind === 'performance' && (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex > 7)) {
      return res.status(400).json({error:'Invalid Story Studio actor image'});
    }
    if (!await projectStore.getProject(username,projectId)) return res.status(404).json({error:'Image not found'});
    const asset = kind === 'identity'
      ? await visualStore.getIdentity(username,projectId,actor)
      : await visualStore.getActor(username,projectId,panelIndex,actor);
    if (!asset) return res.status(404).json({error:'Image not found'});

    const bytes = Buffer.from(asset.base64,'base64');
    res.setHeader('Content-Type',asset.mediaType);
    res.setHeader('Content-Length',String(bytes.length));
    return res.status(200).send(bytes);
  };
}

export default createStoryActorHandler();
