const ACTIVE_KEY = 'nexus:team:active:v1';
const TERMINAL = new Set(['completed', 'cancelled']);

async function teamIndexCommand(parts) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Error('Team mission index is unavailable.');
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(parts),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Team mission index is unavailable.');
  return data.result;
}

function referenceId(owner, groupId, runId) {
  return Buffer.from(JSON.stringify([String(owner), String(groupId), String(runId)])).toString('base64url');
}

function parseHash(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) return Object.values(raw);
  const values=[];for(let index=1;index<raw.length;index+=2)values.push(raw[index]);return values;
}

export function createTeamMissionIndex({ command = teamIndexCommand } = {}) {
  return {
    async track(owner, groupId, run) {
      if (!run?.id) throw new Error('A mission id is required.');
      const field=referenceId(owner,groupId,run.id);
      if (TERMINAL.has(run.state)) { await command(['HDEL', ACTIVE_KEY, field]); return false; }
      await command(['HSET', ACTIVE_KEY, field, JSON.stringify({ owner:String(owner), group_id:String(groupId), run_id:run.id, state:run.state, updated_at:run.updated_at || Date.now() })]);
      return true;
    },
    async remove(owner, groupId, runId) {
      await command(['HDEL',ACTIVE_KEY,referenceId(owner,groupId,runId)]);
      return true;
    },
    async list(limit = 24) {
      const raw=await command(['HGETALL',ACTIVE_KEY]),items=[];
      for(const value of parseHash(raw)){try{const item=JSON.parse(value);if(item?.owner && item?.group_id && item?.run_id)items.push(item);}catch{}}
      return items.sort((a,b)=>(a.updated_at || 0)-(b.updated_at || 0)).slice(0,Math.max(1,Math.min(100,limit)));
    },
  };
}

export const teamMissionIndex=createTeamMissionIndex();
