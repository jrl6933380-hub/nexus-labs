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
import { getAgentConfig } from '../lib/siteAgent.js';
import { checkLiveSiteAllowance, recordLiveSite, takeSiteOffline } from '../lib/roomLiveSites.js';
import { deleteStaticSite } from '../lib/vercel.js';

const SITE_URL = process.env.SITE_URL || 'https://nexus-labs-sigma.vercel.app';

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
  // Injectable like the rest: this was added later as a direct import, which
  // meant any caller without live Redis (tests included) crashed here and
  // fell into the generic 500 below, masking the real publish path.
  readAgentConfig = getAgentConfig,
  checkAllowance = checkLiveSiteAllowance,
  recordSite = recordLiveSite,
  takeOffline = takeSiteOffline,
  deleteSite = deleteStaticSite,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST' && req.method !== 'DELETE') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    try {
      const username = await resolveUser(req);
      if (!username) {
        return res.status(401).json({ error: 'Sign in required' });
      }

      // DELETE ?projectId= takes a live site down for real and frees the
      // plan slot. Scoped to the caller's own live sites, so a guessed id
      // can only ever take down something they already own.
      if (req.method === 'DELETE') {
        const projectId = (req.query || {}).projectId;
        if (typeof projectId !== 'string' || !projectId || projectId.length > 200) {
          return res.status(400).json({ error: 'A projectId is required' });
        }
        const result = await takeOffline({ userId: username, projectId, deleteSite });
        if (!result.tornDown && !result.removed) {
          return res.status(409).json({ error: result.reason || 'Could not take that site offline.' });
        }
        return res.status(200).json(result);
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
      let html = build.html;
      const projectId = build.projectId || id;

      // Per-plan live-site cap. Republishing an already-live project is an
      // update to that same site and never consumes another slot, so this
      // only ever stops taking a NEW project live.
      const allowance = await checkAllowance({ userId: username, projectId, plan });
      if (!allowance.allowed) {
        return res.status(409).json({
          error: `Your plan includes ${allowance.limit} live ${allowance.limit === 1 ? 'site' : 'sites'}, and ${allowance.used} ${allowance.used === 1 ? 'is' : 'are'} already live. Take one down or upgrade to add another.`,
          code: 'LIVE_SITE_LIMIT_REACHED',
          limit: allowance.limit,
          used: allowance.used,
        });
      }
      const agentConfig = await readAgentConfig(projectId);
      if (agentConfig?.enabled && html.includes('</body>')) {
        const widgetTag = `<script src="${SITE_URL}/site-agent-widget.js" data-project="${projectId}"></script>`;
        html = html.replace('</body>', `${widgetTag}\n</body>`);
      }
      const projectName = slugForProject(username, projectId);
      const result = await publish({ projectName, html });
      if (!result.deployed) {
        return res.status(502).json({ error: 'Publish failed.', reason: result.reason || null });
      }
      // Only record after a confirmed deploy, so a failed publish never
      // burns one of the customer's live-site slots.
      try {
        await recordSite(username, projectId, {
          url: result.url,
          deploymentId: result.deployment_id,
          projectName,
        });
      } catch (registryError) {
        console.error('room-publish: live-site registry write failed:', registryError.message);
      }
      return res.status(200).json({ url: result.url, deployment_id: result.deployment_id });
    } catch (err) {
      console.error('room-publish handler crashed:', err.message);
      return res.status(500).json({ error: 'Failed to publish site' });
    }
  };
}

export default createPublishHandler();
