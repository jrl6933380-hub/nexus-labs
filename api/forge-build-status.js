import { getRequestUser } from '../lib/roomAuth.js';
import { getBuildJob } from '../lib/forge/buildJobs.js';

export function createBuildStatusHandler({ resolveUser = getRequestUser, getJob = getBuildJob } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
    const username = await resolveUser(req);
    if (!username) return res.status(401).json({ error: 'Sign in required.' });
    const projectId = String(req.query?.projectId || '');
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    try {
      const job = await getJob(username, projectId, req.query?.jobId);
      // A function killed by the platform cannot update its record. Never
      // leave a returning customer watching an endless "still building".
      const stale = job?.status === 'building' && Date.now() - job.createdAt > 6 * 60_000;
      return res.status(200).json({ job: stale
        ? { ...job, status: 'failed', message: 'That build took too long. Your saved project was not changed.' }
        : job });
    } catch (error) {
      console.error('forge-build-status:', error.message);
      return res.status(503).json({ error: 'Build status is temporarily unavailable.' });
    }
  };
}

export default createBuildStatusHandler();
