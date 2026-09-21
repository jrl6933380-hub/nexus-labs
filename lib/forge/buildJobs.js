import { randomUUID } from 'node:crypto';

const TTL_SECONDS = 24 * 60 * 60;
const ID_RE = /^[a-f0-9-]{36}$/;
const PROJECT_RE = /^[a-zA-Z0-9_-]{1,120}$/;

function jobKey(username, id) { return `forge:build:job:${username}:${id}`; }
function latestKey(username, projectId) { return `forge:build:latest:${username}:${projectId}`; }

async function command(parts) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Build status storage is unavailable');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(parts),
  });
  if (!response.ok) throw new Error('Build status storage failed');
  const data = await response.json();
  if (data.error) throw new Error('Build status storage failed');
  return data.result;
}

export async function createBuildJob(username, projectId) {
  if (!username || !PROJECT_RE.test(projectId)) throw new Error('Invalid build owner or project');
  const job = { id: randomUUID(), projectId, status: 'building', createdAt: Date.now() };
  await command(['SET', jobKey(username, job.id), JSON.stringify(job), 'EX', TTL_SECONDS]);
  await command(['SET', latestKey(username, projectId), job.id, 'EX', TTL_SECONDS]);
  return job;
}

export async function getBuildJob(username, projectId, id) {
  if (!username || !PROJECT_RE.test(projectId)) return null;
  const jobId = id || await command(['GET', latestKey(username, projectId)]);
  if (!ID_RE.test(String(jobId || ''))) return null;
  const raw = await command(['GET', jobKey(username, jobId)]);
  if (!raw) return null;
  let job;
  try { job = JSON.parse(raw); } catch { return null; }
  return job.projectId === projectId && job.id === jobId ? job : null;
}

export async function finishBuildJob(username, job, status, fields = {}) {
  if (!job || !['complete', 'failed'].includes(status)) return;
  const current = await getBuildJob(username, job.projectId, job.id);
  if (!current || current.status !== 'building') return;
  const next = { ...current, status, finishedAt: Date.now(), ...fields };
  await command(['SET', jobKey(username, job.id), JSON.stringify(next), 'EX', TTL_SECONDS]);
}
