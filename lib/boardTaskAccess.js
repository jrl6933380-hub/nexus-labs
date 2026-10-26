import {appendCheckpoint, claimConflict} from './boardGoals.js';
// Compare the exact stored bytes inside one Redis EVAL / Neon transaction.
// All task edits share this check so an old note/progress update cannot undo a claim.
export const TASK_CAS = "if redis.call('HGET',KEYS[1],ARGV[1]) ~= ARGV[2] then return 0 end redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]) return 1";
export function createBoardTaskAccess(command, key, now = Date.now) {
  const baselines = new WeakMap();
  const access = {
    async get(id) {
      const raw = await command(['HGET', key, id]);
      if (!raw) throw Object.assign(new Error(`Task not found: ${id}`), {status:404});
      const task = JSON.parse(raw);
      baselines.set(task, raw);
      return task;
    },
    async claim({id, owner, force}) {
      if (typeof owner !== 'string' || !owner.trim()) throw Object.assign(new Error('An owner is required to claim a task.'), {status:400});
      const task = await access.get(id);
      const conflict = claimConflict(task, owner, force === true);
      if (conflict) throw Object.assign(new Error(conflict), {status:409});
      task.owner = owner;
      if (task.status === 'idle') task.status = 'planning';
      appendCheckpoint(task, {status:task.status, note:`claimed by ${owner}`, by:owner});
      return access.save(task);
    },
    async save(task) {
      const before = baselines.get(task);
      if (before === undefined) throw new Error('Read the task before saving it.');
      task.updated_at = now();
      const next = JSON.stringify(task);
      const saved = await command(['EVAL', TASK_CAS, 1, key, task.id, before, next]);
      if (saved !== 1) throw Object.assign(new Error('This task changed. Refresh it before retrying your update.'), {status:409,code:'TASK_CHANGED'});
      baselines.set(task, next);
      return task;
    },
  };
  return access;
}
