// Owner-only, same-origin, typed-confirmation reset of Forge test data. See lib/forgeReset.js for exactly what it clears.
import '../lib/store/installFetch.js';
import { resolveWorkspaceAccount } from '../lib/workspaceConnector.js';
import { resetForge } from '../lib/forgeReset.js';

function sameOrigin(req) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  if (!origin) return false;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
export function createForgeResetHandler({ resolveAccount = resolveWorkspaceAccount, reset = resetForge } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Open Nexus Forge.' });
      if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return res.status(415).json({ error: 'JSON required.' });
      const owner = await resolveAccount(req);
      if (owner?.owner !== true) return res.status(403).json({ error: 'Owner only.' });
      const b = req.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'Invalid request.' });
      return res.status(200).json(await reset({ confirm: b.confirm }));
    } catch (e) { console.error('forge-reset failed:', String(e?.message || e).slice(0, 160)); return res.status(e.status || 503).json({ error: e.status ? e.message : 'Reset unavailable.' }); }
  };
}
export default createForgeResetHandler();
