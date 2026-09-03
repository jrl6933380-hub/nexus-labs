// /api/snapshot-vault.js
// Versioned snapshot vault endpoint. Never returns credentials or raw tool output.
import { listSnapshotVersions, restoreSnapshotVersion, saveSnapshotVersion } from '../lib/snapshotVault.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { version_id, label } = req.query || {};
      if (version_id) return res.status(200).json({ snapshot: await restoreSnapshotVersion(String(version_id)) });
      return res.status(200).json({ versions: await listSnapshotVersions(label ? String(label) : null) });
    }
    if (req.method === 'POST') {
      const { snapshot, label } = req.body || {};
      return res.status(200).json({ version: await saveSnapshotVersion(snapshot, label) });
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('snapshot vault handler failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
