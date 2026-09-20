// Authenticated control plane for a customer's project Build Plan.
// Credentials never enter this route. Every readiness claim comes from a
// provider-aware verifier in lib/forge/stackActions.js.

import { getRequestUser } from '../lib/roomAuth.js';
import {
  ensureStackManifest,
  applyStackRecommendation,
  selectStackProvider,
  resetStackSlot,
  publicStack,
} from '../lib/forgeStack.js';
import { describeStackActions, runStackAction, runStackSetup } from '../lib/forge/stackActions.js';

function projectIdFrom(req) {
  return String((req.query || {}).projectId || (req.body || {}).projectId || 'default');
}

function responseFor(manifest, outcome = null) {
  const body = publicStack(manifest);
  body.actions = describeStackActions(manifest);
  if (outcome) body.outcome = outcome;
  return body;
}

export function createForgeStackHandler({
  resolveUser = getRequestUser,
  ensure = ensureStackManifest,
  recommend = applyStackRecommendation,
  select = selectStackProvider,
  reset = resetStackSlot,
  runAction = runStackAction,
  setup = runStackSetup,
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
        return res.status(200).json(responseFor(manifest));
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
          manifest = await reset({ ownerUsername: username, projectId, slotId: body.slotId });
          break;
        case 'run': {
          const result = await runAction({
            ownerUsername: username,
            projectId,
            slotId: body.slotId,
            operation: body.operation,
          });
          const outcome = {
            ok: Boolean(result.ok),
            changed: Boolean(result.changed),
            message: result.message || null,
            next_view: result.next_view || null,
          };
          return res.status(200).json(responseFor(result.manifest, outcome));
        }
        case 'setup': {
          const result = await setup({ ownerUsername: username, projectId });
          const outcome = {
            ok: Boolean(result.ok),
            changed: Boolean(result.changed),
            message: result.message || null,
            completed: result.completed || [],
            waiting: result.waiting || [],
            later: result.later || [],
            next_view: result.waiting?.find((item) => item.next_view)?.next_view || null,
          };
          return res.status(200).json(responseFor(result.manifest, outcome));
        }
        default:
          return res.status(400).json({ error: 'Unknown stack action.' });
      }
      return res.status(200).json(responseFor(manifest));
    } catch (error) {
      const message = error?.message || 'Build Plan setup failed.';
      const status = /required|invalid|unknown|not available|transition|selected/i.test(message) ? 400 : 500;
      if (status === 500) console.error('forge-stack failed:', message);
      return res.status(status).json({ error: status === 500 ? 'Build Plan setup failed.' : message });
    }
  };
}

export default createForgeStackHandler();
