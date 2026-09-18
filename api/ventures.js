// api/ventures.js
// Read-only, operator-only view of every venture canvas — powers the
// Venture Factory home page's app-icon grid. Thin wrapper: all the
// real logic already existed in lib/venturesOverview.js for Nex's own
// "how's everything looking?" tool; this just exposes the same data
// to the page itself.

import { getNexusOwner } from '../lib/nexusOwnerAuth.js';
import { getVenturesOverview } from '../lib/venturesOverview.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  const owner = await getNexusOwner(req);
  if (!owner) return res.status(401).json({ error: 'Nexus owner access required.' });

  try {
    const overview = await getVenturesOverview();
    return res.status(200).json(overview);
  } catch (err) {
    console.error('ventures handler failed:', err.message);
    return res.status(500).json({ error: 'Could not load ventures.' });
  }
}
