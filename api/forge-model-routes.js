// api/forge-model-routes.js
//
// The operator's model controller: which model each agent mode actually calls.
//
// Operator-only in both directions, and that is load-bearing rather than
// tidy. These routes decide what Forge spends on every customer request, so
// write access is the ability to raise the platform's cost per build for
// everyone at once. Read access is restricted too: the model line-up is an
// operating detail, and publishing it invites customers to reason about which
// mode "really" gets the good model rather than about what they are trying to
// build.
//
// GET  -> current routes plus the defaults, so the dashboard can show what is
//         configured versus what would apply if nothing were.
// POST -> replace the routes. Unknown modes and empty values fall back to the
//         defaults rather than being stored as-is.

import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';
import { getRoutes, saveRoutes, DEFAULT_ROUTES, AGENT_MODES } from '../lib/forge/agentModes.js';

export default async function handler(req, res) {
  let username;
  try {
    username = await getRequestUser(req);
  } catch (error) {
    console.error('forge-model-routes: session check failed:', error.message);
    return res.status(500).json({ error: 'Could not check your session.' });
  }

  // A non-operator gets 404, not 403: a 403 confirms the endpoint exists and
  // that there is something here worth having access to.
  if (!username || !isOperatorUser(username)) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (req.method === 'GET') {
    try {
      return res.status(200).json({
        routes: await getRoutes(),
        defaults: DEFAULT_ROUTES,
        modes: Object.values(AGENT_MODES).map(({ id, label, goal }) => ({ id, label, goal })),
      });
    } catch (error) {
      console.error('forge-model-routes: read failed:', error.message);
      return res.status(500).json({ error: 'Could not read the model routes.' });
    }
  }

  if (req.method === 'POST') {
    try {
      const routes = await saveRoutes(req.body?.routes || {});
      // Logged with the operator's name: this changes spend for every
      // customer, so it should be traceable afterwards.
      console.log('forge-model-routes: routes updated by', username, JSON.stringify(routes));
      return res.status(200).json({ ok: true, routes });
    } catch (error) {
      console.error('forge-model-routes: save failed:', error.message);
      return res.status(500).json({ error: 'Could not save the model routes.' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
