// /lib/vercel.js
// Links a newly created GitHub repo to a new Vercel project, so it
// gets real branch preview URLs automatically on every push — the
// same behavior Vercel already gives any git-connected project, just
// applied the moment a repo is created instead of as a manual step.

// Accepts either name — Vercel's dashboard doesn't allow renaming an
// existing env var (only editing its value), so this reads whichever
// one is actually set instead of forcing a delete-and-recreate.
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || process.env.NEXS_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID; // optional — omit for a personal-scope token
const VERCEL_API = 'https://api.vercel.com';

function withTeam(path) {
  if (!VERCEL_TEAM_ID) return path;
  return `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(VERCEL_TEAM_ID)}`;
}

async function vercelRequest(path, options = {}) {
  if (!VERCEL_TOKEN) throw new Error('No Vercel token configured (checked VERCEL_TOKEN and NEXS_TOKEN).');
  const res = await fetch(`${VERCEL_API}${withTeam(path)}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`Vercel API error (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

function gitMetadata(deployment = {}) {
  const meta = deployment.meta || {};
  return {
    branch: meta.githubCommitRef || meta.gitlabCommitRef || meta.bitbucketCommitRef || null,
    commit_sha: meta.githubCommitSha || meta.gitlabCommitSha || meta.bitbucketCommitSha || null,
    repo: meta.githubRepo || meta.gitlabProjectRepo || meta.bitbucketRepoName || null,
    org: meta.githubOrg || meta.gitlabProjectNamespace || meta.bitbucketRepoOwner || null,
    commit_message: meta.githubCommitMessage || meta.gitlabCommitMessage || meta.bitbucketCommitMessage || null,
  };
}

export function formatDeployment(deployment = {}) {
  return {
    id: deployment.uid || deployment.id || null,
    name: deployment.name || null,
    url: deployment.url || null,
    state: deployment.state || deployment.readyState || null,
    target: deployment.target || null,
    created_at: deployment.createdAt || deployment.created || null,
    ready_at: deployment.ready || null,
    ready: (deployment.state || deployment.readyState) === 'READY',
    failed: ['ERROR', 'CANCELED'].includes(deployment.state || deployment.readyState),
    ...gitMetadata(deployment),
  };
}

export function formatBuildEvent(event = {}) {
  const payload = event.payload || {};
  const text = event.text || payload.text || payload?.info?.name || '';
  return {
    type: event.type || null,
    created_at: event.created || payload.created || payload.date || null,
    status_code: event.statusCode || payload.statusCode || null,
    text,
    build_id: event.buildId || payload.id || payload?.info?.id || null,
  };
}

function normalizeDeploymentId(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}

export async function listVercelProjects({ limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const data = await vercelRequest(`/v10/projects?limit=${safeLimit}`, { method: 'GET' });
  return (data?.projects || []).map((project) => ({
    id: project.id,
    name: project.name,
    framework: project.framework || null,
    created_at: project.createdAt || null,
    updated_at: project.updatedAt || null,
    linked_repo: project.link
      ? (project.link.org && project.link.repo ? `${project.link.org}/${project.link.repo}` : project.link.repoPath || project.link.repo || null)
      : null,
  }));
}

export async function listVercelDeployments({ project_id, limit = 20, target, state, branch, sha } = {}) {
  if (!project_id) throw new Error('listVercelDeployments requires project_id. Use list_vercel_projects first.');
  const params = new URLSearchParams({
    projectId: project_id,
    limit: String(Math.min(Math.max(Number(limit) || 20, 1), 100)),
  });
  if (target) params.set('target', target);
  if (state) params.set('state', state);
  if (branch) params.set('branch', branch);
  if (sha) params.set('sha', sha);
  const data = await vercelRequest(`/v7/deployments?${params.toString()}`, { method: 'GET' });
  return {
    deployments: (data?.deployments || []).map(formatDeployment),
    pagination: data?.pagination || null,
  };
}

export async function getVercelBuildLogs({ deployment_id, build_id, direction = 'backward', limit = 100, errors_only = false } = {}) {
  if (!deployment_id) throw new Error('getVercelBuildLogs requires deployment_id or deployment URL.');
  const idOrUrl = normalizeDeploymentId(deployment_id);
  const params = new URLSearchParams({
    builds: '1',
    direction: direction === 'forward' ? 'forward' : 'backward',
    limit: String(Math.min(Math.max(Number(limit) || 100, 1), 500)),
  });
  if (build_id) params.set('name', build_id);
  const data = await vercelRequest(`/v3/deployments/${encodeURIComponent(idOrUrl)}/events?${params.toString()}`, { method: 'GET' });
  const events = (Array.isArray(data) ? data : data?.events || []).map(formatBuildEvent);
  const filtered = errors_only
    ? events.filter((event) => /error|stderr|fatal|exit/i.test(`${event.type || ''} ${event.text || ''}`) || Number(event.status_code) >= 400)
    : events;
  return { deployment_id: idOrUrl, direction, errors_only, events: filtered };
}

export async function checkDeploymentStatus({ owner, repo, target } = {}) {
  const projects = await listVercelProjects({ limit: 100 });
  const linkedRepo = `${owner}/${repo}`.toLowerCase();
  const project = projects.find((candidate) => String(candidate.linked_repo || '').toLowerCase() === linkedRepo);
  if (!project) return { found: false, reason: `No Vercel project found linked to ${owner}/${repo}` };
  const result = await listVercelDeployments({ project_id: project.id, limit: 1, target });
  const deployment = result.deployments?.[0];
  if (!deployment) return { found: false, project_id: project.id, project_name: project.name };
  return { found: true, project_id: project.id, project_name: project.name, ...deployment };
}

export async function linkRepoToVercel({ name, owner, repo }) {
  if (!VERCEL_TOKEN) {
    // Not configured — this is expected until the env var is added.
    // Callers should treat this as "skipped", not a hard failure, so
    // repo creation itself never breaks because of it.
    return { linked: false, reason: 'No Vercel token configured (checked VERCEL_TOKEN and NEXS_TOKEN)' };
  }

  let data;
  try {
    data = await vercelRequest('/v9/projects', {
      method: 'POST',
      body: JSON.stringify({
        name,
        gitRepository: { type: 'github', repo: `${owner}/${repo}` },
      }),
    });
  } catch (err) {
    console.error('linkRepoToVercel failed:', err.message);
    return { linked: false, reason: err.message };
  }

  return {
    linked: true,
    project_id: data.id,
    project_name: data.name,
  };
}

// Deploys a single generated HTML page directly as a static Vercel
// deployment — no GitHub repo involved. This is the actual "go live"
// mechanism behind the Hosted/Growth/Unlimited plans: a Room Builder
// project's finished html becomes a real, reachable Vercel URL under
// this account's token. Re-publishing the same projectName creates a
// new deployment on the same underlying Vercel project rather than a
// new project each time, so a customer's site keeps one stable URL
// across edits.
//
// `request` is injectable (defaults to the real vercelRequest) so this
// can be unit tested without a live token or network access, same
// spirit as command injection in lib/roomMetering.js.
export async function deployStaticSite({ projectName, html, target = 'production', request = vercelRequest } = {}) {
  if (!VERCEL_TOKEN) {
    return { deployed: false, reason: 'No Vercel token configured (checked VERCEL_TOKEN and NEXS_TOKEN)' };
  }
  if (!projectName || !/^[a-z0-9-]{1,90}$/.test(projectName)) {
    throw new Error('deployStaticSite requires a projectName matching [a-z0-9-]{1,90} (Vercel project-name rules).');
  }
  if (typeof html !== 'string' || !html) {
    throw new Error('deployStaticSite requires non-empty html.');
  }
  let data;
  try {
    data = await request('/v13/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name: projectName,
        target,
        files: [{ file: 'index.html', data: html }],
        projectSettings: { framework: null },
      }),
    });
  } catch (err) {
    console.error('deployStaticSite failed:', err.message);
    return { deployed: false, reason: err.message };
  }
  return {
    deployed: true,
    deployment_id: data.id,
    project_id: data.projectId || null,
    url: data.url ? `https://${data.url}` : null,
    target,
  };
}
