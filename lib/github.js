// /lib/github.js
// GitHub Contents API helpers, shared by the MCP server.

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
