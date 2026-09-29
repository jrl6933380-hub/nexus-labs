import { getNexusOwner } from '../lib/nexusOwnerAuth.js';
import { controlPod, podStatus, testPod } from '../lib/podController.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const owner = await getNexusOwner(req).catch(() => null);
  if (!owner) return res.status(401).json({ error: 'Nexus owner authentication required.' });

  try {
    if (req.method === 'GET') return res.status(200).json(await podStatus());
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const action = String(req.body?.action || '');
    if (action === 'test') {
      const result = await testPod(req.body?.message);
      return res.status(200).json({ ...result, status: await podStatus() });
    }
    if (!['start', 'stop', 'restart'].includes(action)) {
      return res.status(400).json({ error: 'Use start, stop, restart, or test.' });
    }
    const result = await controlPod(action);
    return res.status(200).json({ ...result, status: await podStatus() });
  } catch (error) {
    console.error('pod-controller:', error.message);
    return res.status(error.status && error.status < 500 ? error.status : 503).json({ error: error.message });
  }
}
