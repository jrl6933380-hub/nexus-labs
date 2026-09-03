// /lib/github.js
// GitHub Contents API helpers, shared by the MCP server.

import { linkRepoToVercel } from './vercel.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = 'https://api.github.com';

async function githubRequest(path, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
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

async function getFileSha(owner, repo, path, branch) {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const { ok, data } = await githubRequest(`/repos/${owner}/${repo}/contents/${path}${query}`);
  if (ok && data && !Array.isArray(data)) return data.sha;
  return null;
}

// Exported so callers (like the direct-write vs. queued-write decision
// in lib/nexBrain.js) can check whether a given branch IS the
// live/default one before deciding it's safe to skip the approval
// queue. Never guess or hardcode "main" for this — always ask GitHub.
export async function getDefaultBranch(owner, repo) {
  const { ok, data } = await githubRequest(`/repos/${owner}/${repo}`);
  if (ok && data?.default_branch) return data.default_branch;
  return 'main';
}

async function getBranchSha(owner, repo, branch) {
  const { ok, data } = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  if (ok && data?.object?.sha) return data.object.sha;
  return null;
}

async function getCommitTreeSha(owner, repo, commitSha) {
  const { ok, data } = await githubRequest(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
  if (ok && data?.tree?.sha) return data.tree.sha;
  return null;
}

export async function createOrUpdateFile({ owner, repo, path, content, message, branch }) {
  const existingSha = await getFileSha(owner, repo, path, branch);
  const body = {
    message: message || (existingSha ? `Update ${path}` : `Create ${path}`),
    content: Buffer.from(content, 'utf-8').toString('base64'),
    ...(existingSha ? { sha: existingSha } : {}),
    ...(branch ? { branch } : {}),
  };
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path}`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return { path, sha: data?.content?.sha, committed: true };
}

export async function deleteFile({ owner, repo, path, message, branch }) {
  const sha = await getFileSha(owner, repo, path, branch);
  if (!sha) throw new Error(`File not found: ${path}`);
  const body = { message: message || `Delete ${path}`, sha, ...(branch ? { branch } : {}) };
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path}`,
    { method: 'DELETE', body: JSON.stringify(body) }
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return { path, deleted: true };
}

export async function listFiles({ owner, repo, path, branch }) {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path || ''}${query}`
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  if (!Array.isArray(data)) return [{ name: data.name, path: data.path, type: data.type }];
  return data.map((item) => ({ name: item.name, path: item.path, type: item.type }));
}

export async function readFile({ owner, repo, path, branch }) {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path}${query}`
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  if (Array.isArray(data)) throw new Error(`Path is a directory, not a file: ${path}`);
  const content = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '';
  return { path, content, sha: data.sha };
}

export async function createRepo({ owner, name, description, private: isPrivate = false }) {
  // Assumes the owner is the same account the GITHUB_TOKEN belongs to
  // (a personal repo, not an org). /user/repos creates under whoever
  // the token authenticates as — there's no separate "owner" param on
  // this endpoint.
  const body = {
    name,
    description: description || '',
    private: isPrivate,
    auto_init: true, // creates an initial commit/README so the repo has a real default branch right away
  };
  const { ok, status, data } = await githubRequest('/user/repos', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);

  // Link to a new Vercel project right away, so pushes to any branch on
  // this repo get real preview URLs automatically. Never lets a Vercel
  // hiccup undo or block the GitHub repo creation that already succeeded.
  const vercel = await linkRepoToVercel({ name: data.name, owner: data.owner.login, repo: data.name });

  return {
    name: data.name,
    full_name: data.full_name,
    html_url: data.html_url,
    default_branch: data.default_branch,
    created: true,
    vercel,
  };
}

export async function createBranch({ owner, repo, branch, from_branch }) {
  const base = from_branch || (await getDefaultBranch(owner, repo));
  const baseSha = await getBranchSha(owner, repo, base);
  if (!baseSha) throw new Error(`Could not find base branch "${base}" to branch from.`);
  const body = { ref: `refs/heads/${branch}`, sha: baseSha };
  const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return { branch, from_branch: base, created: true };
}

export async function createPullRequest({ owner, repo, title, head, base, body: prBody }) {
  const baseBranch = base || (await getDefaultBranch(owner, repo));
  const requestBody = { title, head, base: baseBranch, body: prBody || '' };
  const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return {
    number: data.number,
    html_url: data.html_url,
    title: data.title,
    state: data.state,
    created: true,
  };
}

export async function deleteRepo({ owner, repo }) {
  // Irreversible — GitHub does not soft-delete or trash repositories.
  const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}`, {
    method: 'DELETE',
  });
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return { owner, repo, deleted: true };
}

export async function listRepos({ owner } = {}) {
  // /user/repos returns everything the token can see (owned, collaborator,
  // and org repos), private ones included — /users/{owner}/repos only
  // returns PUBLIC repos, which would hide things like a private sandbox
  // repo from Nex. So always pull from /user/repos and filter by owner
  // afterward instead of guessing which endpoint fits a given owner.
  const results = [];
  let page = 1;
  while (true) {
    const { ok, status, data } = await githubRequest(
      `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`
    );
    if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 100) break;
    page++;
  }
  const filtered = owner
    ? results.filter((r) => r.owner?.login?.toLowerCase() === owner.toLowerCase())
    : results;
  return filtered.map((r) => ({
    name: r.name,
    full_name: r.full_name,
    owner: r.owner?.login,
    private: r.private,
    default_branch: r.default_branch,
    html_url: r.html_url,
    description: r.description,
    updated_at: r.updated_at,
  }));
}

export async function searchCode({ owner, repo, query }) {
  // GitHub's code search — finds where something actually lives instead
  // of guessing at folder paths. Scoped to one repo with repo:owner/repo.
  const q = `${query} repo:${owner}/${repo}`;
  const { ok, status, data } = await githubRequest(`/search/code?q=${encodeURIComponent(q)}`);
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return {
    total_count: data.total_count,
    items: (data.items || []).map((item) => ({
      name: item.name,
      path: item.path,
      html_url: item.html_url,
    })),
  };
}

export async function readIssue({ owner, repo, issue_number }) {
  // Fetch an issue plus its comments. Issue/comment bodies are plain
  // markdown text, so screenshots embedded as markdown image links come
  // through automatically — covers "read the issue" and "see what's in
  // the screenshot" in one call, no separate image handling needed.
  const { ok: issueOk, status: issueStatus, data: issueData } = await githubRequest(
    `/repos/${owner}/${repo}/issues/${issue_number}`
  );
  if (!issueOk) throw new Error(`GitHub API error fetching issue (${issueStatus}): ${JSON.stringify(issueData).slice(0, 300)}`);

  const { ok: commentsOk, status: commentsStatus, data: commentsData } = await githubRequest(
    `/repos/${owner}/${repo}/issues/${issue_number}/comments?per_page=100`
  );
  const comments = commentsOk && Array.isArray(commentsData) ? commentsData : [];

  return {
    number: issueData.number,
    title: issueData.title,
    state: issueData.state,
    body: issueData.body || '',
    user: issueData.user?.login,
    created_at: issueData.created_at,
    updated_at: issueData.updated_at,
    html_url: issueData.html_url,
    comments: comments.map((c) => ({
      id: c.id,
      user: c.user?.login,
      body: c.body,
      created_at: c.created_at,
      updated_at: c.updated_at,
      html_url: c.html_url,
    })),
  };
}

export async function readPullRequest({ owner, repo, pr_number }) {
  // Fetch a PR's own details plus its review-comment thread. Like
  // readIssue, body/comment text may contain markdown image links.
  const { ok: prOk, status: prStatus, data: prData } = await githubRequest(
    `/repos/${owner}/${repo}/pulls/${pr_number}`
  );
  if (!prOk) throw new Error(`GitHub API error fetching PR (${prStatus}): ${JSON.stringify(prData).slice(0, 300)}`);

  const { ok: commentsOk, status: commentsStatus, data: commentsData } = await githubRequest(
    `/repos/${owner}/${repo}/pulls/${pr_number}/comments?per_page=100`
  );
  const comments = commentsOk && Array.isArray(commentsData) ? commentsData : [];

  return {
    number: prData.number,
    title: prData.title,
    state: prData.state,
    body: prData.body || '',
    user: prData.user?.login,
    head: prData.head?.ref,
    base: prData.base?.ref,
    mergeable_state: prData.mergeable_state,
    created_at: prData.created_at,
    updated_at: prData.updated_at,
    html_url: prData.html_url,
    comments: comments.map((c) => ({
      id: c.id,
      user: c.user?.login,
      body: c.body,
      created_at: c.created_at,
      updated_at: c.updated_at,
      html_url: c.html_url,
    })),
  };
}

export async function commitFiles({ owner, repo, branch, message, files }) {
  // Uses the Git Data API (blobs -> tree -> commit -> ref) instead of
  // the simple Contents API, so multiple file changes land as ONE
  // atomic commit — either all of them apply, or none do.
  const targetBranch = branch || (await getDefaultBranch(owner, repo));
  const latestCommitSha = await getBranchSha(owner, repo, targetBranch);
  if (!latestCommitSha) throw new Error(`Could not find branch "${targetBranch}".`);
  const baseTreeSha = await getCommitTreeSha(owner, repo, latestCommitSha);
  if (!baseTreeSha) throw new Error(`Could not resolve base tree for branch "${targetBranch}".`);

  const treeEntries = [];
  for (const file of files) {
    if (file.content === undefined || file.content === null) {
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
    });
    if (!ok) throw new Error(`GitHub API error creating blob for ${file.path} (${status}): ${JSON.stringify(data).slice(0, 300)}`);
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: data.sha });
  }

  const treeRes = await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw new Error(`GitHub API error creating tree (${treeRes.status}): ${JSON.stringify(treeRes.data).slice(0, 300)}`);

  const commitRes = await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: message || `Batch commit: ${files.length} file(s)`,
      tree: treeRes.data.sha,
      parents: [latestCommitSha],
    }),
  });
  if (!commitRes.ok) throw new Error(`GitHub API error creating commit (${commitRes.status}): ${JSON.stringify(commitRes.data).slice(0, 300)}`);

  const refRes = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${targetBranch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitRes.data.sha }),
  });
  if (!refRes.ok) throw new Error(`GitHub API error updating branch ref (${refRes.status}): ${JSON.stringify(refRes.data).slice(0, 300)}`);

  return {
    branch: targetBranch,
    commit_sha: commitRes.data.sha,
    files_changed: files.length,
    committed: true,
  };
}
