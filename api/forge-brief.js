// api/forge-brief.js
// Authenticated Project Brief endpoint for the Forge interview experience.

import { getRequestUser } from '../lib/roomAuth.js';
import {
  ensureProjectBrief,
  saveBriefAnswer,
  resetProjectBrief,
  publicProjectBrief,
} from '../lib/forge/projectBrief.js';

function projectIdFrom(req) {
  return String((req.query || {}).projectId || (req.body || {}).projectId || 'default');
}

export function createForgeBriefHandler({
  resolveUser = getRequestUser,
  ensure = ensureProjectBrief,
  answer = saveBriefAnswer,
  reset = resetProjectBrief,
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
      let brief;

      if (req.method === 'GET') {
        brief = await ensure({ ownerUsername: username, projectId });
      } else {
        const body = req.body || {};
        if (body.action === 'answer') {
          brief = await answer({
            ownerUsername: username,
            projectId,
            questionId: body.questionId,
            values: body.values,
            comment: body.comment,
          });
        } else if (body.action === 'reset') {
          brief = await reset({ ownerUsername: username, projectId });
        } else if (body.action === 'ensure') {
          brief = await ensure({ ownerUsername: username, projectId });
        } else {
          return res.status(400).json({ error: 'Unknown Project Brief action.' });
        }
      }

      return res.status(200).json(publicProjectBrief(brief));
    } catch (error) {
      const message = error?.message || 'Project Brief failed.';
      const status = /required|invalid|unknown|choose/i.test(message) ? 400 : 500;
      if (status === 500) console.error('forge-brief failed:', message);
      return res.status(status).json({ error: status === 500 ? 'Project Brief failed.' : message });
    }
  };
}

export default createForgeBriefHandler();
