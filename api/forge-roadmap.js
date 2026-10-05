// Account-scoped Project Path. Nex receives the full operational roadmap;
// customers receive only its stable, evidence-backed visual projection.
import { getRequestUser } from '../lib/roomAuth.js';
import { getProjectRoadmap, publicProjectRoadmap } from '../lib/forge/projectRoadmap.js';

export function createForgeRoadmapHandler({ resolveUser = getRequestUser, readRoadmap = getProjectRoadmap } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
    try {
      const username = await resolveUser(req);
      if (!username) return res.status(401).json({ error: 'Sign in required.' });
      const projectId = String(req.query?.projectId || '');
      const roadmap = await readRoadmap({ ownerUsername: username, projectId });
      return res.status(200).json(publicProjectRoadmap(roadmap));
    } catch (error) {
      const status = /required|invalid/i.test(error?.message || '') ? 400 : 500;
      if (status === 500) console.error('forge-roadmap failed:', error?.message);
      return res.status(status).json({ error: status === 500 ? 'Project Path could not load.' : error.message });
    }
  };
}

export default createForgeRoadmapHandler();
