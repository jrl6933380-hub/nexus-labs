// api/forge-stack.js
// Authenticated control plane for a customer's project Stack Manifest.
// This route never accepts or returns credentials. Provider callbacks and
// provisioning workers will advance selected slots through connected/testing/
// ready using lib/forgeStack.js in later slices.

import { getRequestUser } from '../lib/roomAuth.js';
import {
  ensureStackManifest,
  applyStackRecommendation,
  selectStackProvider,
  resetStackSlot,
  publicStack,
} from '../lib/forgeStack.js';

function projectIdFrom(req) {
  return String((req.query || {}).projectId || (req.body || {}).projectId || 'default');
}

export function createForgeStackHandler({
  resolveUser = getRequestUser,
  ensure = ensureStackManifest,
  recommend = applyStackRecommendation,
  select = selectStackProvider,
  reset = resetStackSlot,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
      const username = await resolveUser(req);
      if (!username) return res.status(401).json({ error: 'Sign in required.' });
      const projectId = projectIdFrom(req);

      if (req.method === 'GET') {
        const manifest = await ensure({ ownerUsername: username, projectId });
        return res.status(200).json(publicStack(manifest));
      }

      const body = req.body || {};
      let manifest;
      switch (body.action) {
        case 'ensure':
          manifest = await ensure({
            ownerUsername: username,
            projectId,
            projectName: body.projectName,
            projectType: body.projectType,
            features: body.features,
          });
          break;
        case 'recommend':
          manifest = await recommend({
            ownerUsername: username,
            projectId,
            projectType: body.projectType,
            features: body.features,
          });
          break;
        case 'select':
          manifest = await select({
            ownerUsername: username,
            projectId,
            slotId: body.slotId,
            provider: body.provider,
            mode: body.mode,
          });
          break;
        case 'reset':
          manifest = await reset({
            ownerUsername: username,
            projectId,
            slotId: body.slotId,
          });
          break;
        default:
          return res.status(400).json({ error: 'Unknown stack action.' });
      }
      return res.status(200).json(publicStack(manifest));
    } catch (error) {
      const message = error?.message || 'Stack setup failed.';
      const status = /required|invalid|unknown|not available|transition/i.test(message) ? 400 : 500;
      if (status === 500) console.error('forge-stack failed:', message);
      return res.status(status).json({ error: status === 500 ? 'Stack setup failed.' : message });
    }
  };
}

export default createForgeStackHandler();
