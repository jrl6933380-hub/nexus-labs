import { getRequestUser } from '../lib/roomAuth.js';
import {
  beginOpenRouterOAuth,
  completeOpenRouterOAuth,
  forgeCredentialScope,
} from '../lib/openRouterConnection.js';
import {
  storeTenantCredential,
  hasTenantCredential,
  deleteTenantCredential,
} from '../lib/tenantCredentials.js';
import {
  ensureStackManifest,
  selectStackProvider,
  setStackSlotState,
  resetStackSlot,
} from '../lib/forgeStack.js';

function projectIdFrom(req) {
  return String((req.query || {}).projectId || (req.body || {}).projectId || 'default');
}

function sendRedirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  return res.end();
}

function forgeReturnUrl(result) {
  return `/forge.html?view=brain&connection=${encodeURIComponent(result)}`;
}

export function createOpenRouterOAuthHandler({
  resolveUser = getRequestUser,
  begin = beginOpenRouterOAuth,
  complete = completeOpenRouterOAuth,
  storeCredential = storeTenantCredential,
  credentialExists = hasTenantCredential,
  deleteCredential = deleteTenantCredential,
  ensureStack = ensureStackManifest,
  selectProvider = selectStackProvider,
  setSlotState = setStackSlotState,
  resetSlot = resetStackSlot,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const username = await resolveUser(req);
    if (!username) {
      if (req.method === 'GET') return sendRedirect(res, '/room-login.html?next=%2Fforge.html%3Fview%3Dbrain');
      return res.status(401).json({ error: 'Sign in required.' });
    }

    const action = String((req.query || {}).action || (req.body || {}).action || 'status');
    const projectId = projectIdFrom(req);
    const tenantId = forgeCredentialScope({ ownerUsername: username, projectId });

    try {
      if (req.method === 'GET' && action === 'start') {
        await selectProvider({ ownerUsername: username, projectId, slotId: 'brain', provider: 'openrouter', mode: 'oauth-pkce' });
        await setSlotState({ ownerUsername: username, projectId, slotId: 'brain', status: 'connecting' });
        const started = await begin({ ownerUsername: username, projectId });
        return sendRedirect(res, started.authorizeUrl);
      }

      if (req.method === 'GET' && action === 'callback') {
        const connected = await complete({
          state: String((req.query || {}).state || ''),
          code: String((req.query || {}).code || ''),
          ownerUsername: username,
        });
        await storeCredential({ tenantId: connected.tenantId, provider: 'openrouter', accessToken: connected.accessToken });
        await setSlotState({ ownerUsername: username, projectId: connected.projectId, slotId: 'brain', status: 'connected', metadata: connected.metadata });
        await setSlotState({ ownerUsername: username, projectId: connected.projectId, slotId: 'brain', status: 'testing' });
        await setSlotState({ ownerUsername: username, projectId: connected.projectId, slotId: 'brain', status: 'ready' });
        return sendRedirect(res, forgeReturnUrl('success'));
      }

      if (req.method === 'POST' && action === 'disconnect') {
        await deleteCredential({ tenantId, provider: 'openrouter' });
        await resetSlot({ ownerUsername: username, projectId, slotId: 'brain' });
        return res.status(200).json({ connected: false, provider: 'openrouter' });
      }

      if (req.method === 'GET' && action === 'status') {
        const manifest = await ensureStack({ ownerUsername: username, projectId });
        const slot = manifest.slots?.brain || {};
        const connected = await credentialExists({ tenantId, provider: 'openrouter' });
        return res.status(200).json({
          provider: 'openrouter',
          connected,
          status: connected ? slot.status : 'not_connected',
          metadata: connected ? slot.metadata || {} : {},
          tested_at: connected ? slot.tested_at || null : null,
        });
      }

      return res.status(400).json({ error: 'Unknown OpenRouter action.' });
    } catch (error) {
      const message = error?.message || 'OpenRouter connection failed.';
      if (req.method === 'GET' && action === 'callback') {
        console.error('openrouter-oauth callback failed:', message);
        return sendRedirect(res, forgeReturnUrl('error'));
      }
      if (req.method === 'GET' && action === 'start') {
        console.error('openrouter-oauth start failed:', message);
        return sendRedirect(res, forgeReturnUrl('error'));
      }
      const status = /required|invalid|unknown|mismatch/i.test(message) ? 400 : 503;
      if (status === 503) console.error('openrouter-oauth failed:', message);
      return res.status(status).json({ error: status === 503 ? 'OpenRouter connection is temporarily unavailable.' : message });
    }
  };
}

export default createOpenRouterOAuthHandler();
