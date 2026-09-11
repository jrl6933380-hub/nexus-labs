// api/room-publish.js
// Turns a signed-in customer's finished Room Builder project into a
// real, live Vercel deployment on this account (see
// lib/vercel.js#deployStaticSite). Gated the same way code export is
// (api/room-history.js): Free tier can build and preview, but going
// live is one of the things that unlocks with a paid plan.
//
// POST { id: <history build id> } -> { url, deployment_id }

import { getBuild } from '../lib/roomHistory.js';
import { getRequestUser, getUserPlan, isPaidPlan } from '../lib/roomAuth.js';
import { deployStaticSite } from '../lib/vercel.js';

function slugForProject(username, id) {
  // Vercel project names: lowercase letters, digits, hyphens only.
  const safeUser = String(username).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  const safeId = String(id).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  return `room-${safeUser}-${safeId}`.replace(/-+/g, '-').slice(0, 90);
}

export function createPublishHandler({
  resolveUser = getRequestUser,
  readBuild = getBuild,
  resolvePlan = getUserPlan,
  publish = deployStaticSite,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    try {
      const username = await resolveUser(req);
      if (!username) {
        return res.status(401).json({ error: 'Sign in required' });
      }
      const { id } = req.body || {};
      if (typeof id !== 'string' || !id || id.length > 200) {
        return res.status(400).json({ error: 'Invalid publish request' });
      }
      const plan = await resolvePlan(username);
      if (!isPaidPlan(plan)) {
        return res.status(402).json({
          error: 'Going live requires a paid plan.',
          code: 'PUBLISH_REQUIRES_PAID_PLAN',
        });
      }
      const build = await readBuild(username, id);
      if (!build) return res.status(404).json({ error: 'Build not found' });
      if (typeof build.html !== 'string' || !build.html) {
        return res.status(422).json({ error: 'This build has no content to publish yet.' });
      }
      const projectName = slugForProject(username, build.projectId || id);
      const result = await publish({ projectName, html: build.html });
      if (!result.deployed) {
        return res.status(502).json({ error: 'Publish failed.', reason: result.reason || null });
      }
      return res.status(200).json({ url: result.url, deployment_id: result.deployment_id });
    } catch (err) {
      console.error('room-publish handler crashed:', err.message);
      return res.status(500).json({ error: 'Failed to publish site' });
    }
  };
}

export default createPublishHandler();
