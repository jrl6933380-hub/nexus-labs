// Feature access follows the configured runtime, independently of live health.
// A cold pod does not hide saved plans; model calls still check health and meter usage.
import { getConnection } from './brainStore.js';
import { isPodUser } from './podBrain.js';

export function usesPodBrain(username, env = process.env) {
  return Boolean(username && (env.NEX_QWEN_ONLY === 'true' || isPodUser(username, env)));
}

export async function getFeatureConnection(username, { connectionFor = getConnection, env = process.env } = {}) {
  if (!username) return null;
  if (usesPodBrain(username, env)) {
    return { connected: true, provider: 'nex-pod', tier: 'strong', funded: true, tested_at: null };
  }
  return connectionFor(username);
}
