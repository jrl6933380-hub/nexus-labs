// /api/snapshot.js
// Read/write endpoint for the compact system snapshot. It never returns secrets.
import { loadFreshSnapshot, loadSystemSnapshot, saveSystemSnapshot } from '../lib/systemSnapshot.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { current_commit_sha, requested_paths, fresh_only } = req.query || {};
      const result = fresh_only === 'true'
        ? await loadFreshSnapshot({ current_commit_sha, requested_paths: requested_paths ? String(requested_paths).split(',') : [] })
        : { snapshot: await loadSystemSnapshot(), stale: false, reasons: [] };
      return res.status(200).json(result);
    }
    if (req.method === 'POST') {
      return res.status(200).json({ snapshot: await saveSystemSnapshot(req.body || {}) });
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('snapshot handler failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
