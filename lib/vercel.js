// /lib/vercel.js
// Vercel API integration. Three jobs:
// 1. Link a newly created GitHub repo to a new Vercel project, so it
//    gets real branch preview URLs automatically on every push.
// 2. Provision NEW credentials (tokens + env vars) end-to-end, so a
//    raw secret value never has to be typed into chat, Notes, or
//    pasted more than once — generate it and store it in the same
//    motion, using the one bootstrap token that's already configured.
// 3. Look up the live preview URL for a given branch, so Nex can hand
//    back a real testable link instead of guessing at one.

// Accepts either name — Vercel's dashboard doesn't allow renaming an
// existing env var (only editing its value), so this reads whichever
// one is actually set instead of forcing a delete-and-recreate.
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || process.env.NEXS_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID; // optional — omit for a personal-scope token
const VERCEL_API = 'https://api.vercel.com';

async function vercelRequest(path, options = {}) {
  const res = await fetch(`${VERCEL_API}${path}`, {
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
  return { ok: res.ok, status: res.status, data };
}

export async function linkRepoToVercel({ name, owner, repo }) {
  if (!VERCEL_TOKEN) {
    // Not configured — this is expected until the env var is added.
    // Callers should treat this as "skipped", not a hard failure, so
    // repo creation itself never breaks because of it.
    return { linked: false, reason: 'No Vercel token configured (checked VERCEL_TOKEN and NEXS_TOKEN)' };
  }

  const query = VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : '';
  const { ok, status, data } = await vercelRequest(`/v9/projects${query}`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      gitRepository: { type: 'github', repo: `${owner}/${repo}` },
    }),
  });

  if (!ok) {
    // Never lets a Vercel hiccup undo or block a successful GitHub
    // repo creation that already happened.
    console.error('linkRepoToVercel failed:', status, JSON.stringify(data).slice(0, 300));
    return { linked: false, reason: `Vercel API error (${status})` };
  }

  return { linked: true, project_id: data.id, project_name: data.name };
}

export async function createVercelToken({ name, projectId }) {
  if (!VERCEL_TOKEN) throw new Error('No Vercel token configured — cannot create a new one without a bootstrap token.');

  const query = VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : '';
  const body = { name, ...(projectId ? { projectId } : {}) };
  const { ok, status, data } = await vercelRequest(`/v3/user/tokens${query}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!ok) throw new Error(`Vercel API error creating token (${status}): ${JSON.stringify(data).slice(0, 300)}`);

  // bearerToken is returned exactly once, right here — never logged,
  // never persisted anywhere by this function. The caller is expected
  // to immediately hand it to setVercelEnvVar rather than surface it.
  return {
    token_id: data.token.id,
    bearer_token: data.token.bearerToken,
    name: data.token.name,
  };
}

export async function setVercelEnvVar({ projectId, key, value, target }) {
  if (!VERCEL_TOKEN) throw new Error('No Vercel token configured.');

  const teamParam = VERCEL_TEAM_ID ? `&teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : '';
  const { ok, status, data } = await vercelRequest(`/v10/projects/${projectId}/env?upsert=true${teamParam}`, {
    method: 'POST',
    body: JSON.stringify([
      {
        key,
        value,
        type: 'sensitive', // write-only once saved — not even readable back via the dashboard or this API afterward
        target: target || ['production'],
      },
    ]),
  });

  if (!ok) throw new Error(`Vercel API error setting env var (${status}): ${JSON.stringify(data).slice(0, 300)}`);

  return { set: true, key, project_id: projectId };
}

// Convenience wrapper: create a token, then immediately store it as a
// sensitive env var on a target project, in one call. The raw token
// value passes through server memory only — it's never returned to
// the caller of THIS function, only a confirmation that it worked.
export async function provisionTokenAsEnvVar({ tokenName, sourceProjectId, targetProjectId, envKey, target }) {
  const created = await createVercelToken({ name: tokenName, projectId: sourceProjectId });
  await setVercelEnvVar({
    projectId: targetProjectId,
    key: envKey,
    value: created.bearer_token,
    target,
  });
  return { provisioned: true, token_id: created.token_id, env_key: envKey, project_id: targetProjectId };
}

// Looks up the most recent deployment for a given branch on a given
// project, so Nex can hand back a real, live preview URL after a
// push instead of guessing at one. Returns found:false rather than
// throwing if nothing matches yet — a brand new branch may not have
// a deployment for a few seconds after the push.
export async function getBranchDeployment({ projectId, branch }) {
  if (!VERCEL_TOKEN) return { found: false, reason: 'No Vercel token configured (checked VERCEL_TOKEN and NEXS_TOKEN)' };

  const teamParam = VERCEL_TEAM_ID ? `&teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : '';
  const { ok, status, data } = await vercelRequest(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=20${teamParam}`);
  if (!ok) throw new Error(`Vercel API error checking deployments (${status}): ${JSON.stringify(data).slice(0, 300)}`);

  const deployments = data?.deployments || [];
  const match = deployments.find(
    (d) => d.meta?.githubCommitRef === branch || d.gitSource?.ref === branch
  );

  if (!match) return { found: false, reason: `No deployment found yet for branch "${branch}".` };

  return {
    found: true,
    url: `https://${match.url}`,
    state: match.state,
    created_at: match.createdAt,
  };
}
