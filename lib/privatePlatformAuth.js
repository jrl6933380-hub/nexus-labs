import crypto from 'node:crypto';
import { getNexusOwner } from './nexusOwnerAuth.js';

export async function privatePlatformAuthorized(req, { getOwner = getNexusOwner, token = process.env.NEXUS_AGENT_API_TOKEN } = {}) {
  if (await getOwner(req).catch(() => null)) return true;
  const header = String(req.headers?.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !supplied) return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(supplied).digest(), crypto.createHash('sha256').update(token).digest());
}
