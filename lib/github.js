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

async function getFileState(owner, repo, path, branch) {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}/contents/${path}${query}`);
  if (status === 404) return null;
  if (!ok || Array.isArray(data)) {
    throw new Error(`GitHub API error reading ${path} (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return {
    sha: data.sha,
    content: data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '',
  };
}

export function assertSafeFileReplacement(existingContent, nextContent, { path = 'file' } = {}) {
  const before = String(existingContent ?? '');
  const after = String(nextContent ?? '');
  const beforeLines = before ? before.split('\n').length : 0;
  const afterLines = after ? after.split('\n').length : 0;
  const charRatio = before.length ? after.length / before.length : 1;
  const lineRatio = beforeLines ? afterLines / beforeLines : 1;
  const largeCharacterLoss = before.length >= 12_000 && before.length - after.length >= 8_000 && charRatio < 0.65;
  const largeLineLoss = beforeLines >= 300 && beforeLines - afterLines >= 150 && lineRatio < 0.65;

  if (largeCharacterLoss || largeLineLoss) {
    throw new Error(
      `SAFE_REPLACEMENT_BLOCKED: ${path} would shrink from ${beforeLines} to ${afterLines} lines ` +
      `and ${before.length} to ${after.length} characters. Use patch_repo_file for targeted edits; ` +
      'a human must handle an intentional full rewrite.'
    );
  }
  return { before_chars: before.length, after_chars: after.length, before_lines: beforeLines, after_lines: afterLines };
}

export function applyExactReplacements(source, replacements) {
  if (!Array.isArray(replacements) || replacements.length < 1 || replacements.length > 20) {
    throw new Error('patch_repo_file requires 1-20 replacements');
  }
  let content = String(source ?? '');
  for (const [index, operation] of replacements.entries()) {
    const find = typeof operation?.find === 'string' ? operation.find : '';
    const replace = typeof operation?.replace === 'string' ? operation.replace : '';
    const expected = Number.isInteger(operation?.expected_occurrences)
      ? operation.expected_occurrences
      : 1;
    if (!find) throw new Error(`Replacement ${index + 1} has an empty find value`);
    if (expected < 1 || expected > 100) throw new Error(`Replacement ${index + 1} has an invalid expected_occurrences`);
    const actual = content.split(find).length - 1;
    if (actual !== expected) {
      throw new Error(`Replacement ${index + 1} expected ${expected} exact match(es), found ${actual}; reread the target section before retrying`);
    }
    content = content.split(find).join(replace);
  }
  return content;
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
  const existing = await getFileState(owner, repo, path, branch);
  const existingSha = existing?.sha || null;
  if (existing) assertSafeFileReplacement(existing.content, content, { path });
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

export async function patchFile({ owner, repo, path, branch, message, expected_sha, replacements }) {
  if (!branch) throw new Error('patch_repo_file requires a non-live branch');
  const existing = await getFileState(owner, repo, path, branch);
  if (!existing) throw new Error(`File not found: ${path}`);
  if (expected_sha && expected_sha !== existing.sha) {
    throw new Error(`STALE_FILE: ${path} changed after it was read; reread the target section before retrying`);
  }
  const content = applyExactReplacements(existing.content, replacements);
  if (content === existing.content) throw new Error(`Patch made no change to ${path}`);
  const metrics = assertSafeFileReplacement(existing.content, content, { path });
  const body = {
    message: message || `Patch ${path}`,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    sha: existing.sha,
    branch,
  };
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path}`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return { path, sha: data?.content?.sha, committed: true, replacements_applied: replacements.length, ...metrics };
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

function requestedRef({ ref, branch } = {}) {
  return ref || branch || '';
}

export function pageFileContent(content, { start_line, end_line, start_char, max_chars } = {}) {
  const source = String(content ?? '');
  const charLimit = Math.min(Math.max(Number(max_chars) || 6500, 500), 7000);

  if (start_char !== undefined && start_char !== null) {
    const offset = Math.max(0, Number(start_char) || 0);
    const page = source.slice(offset, offset + charLimit);
    const next = offset + page.length;
    return {
      content: page,
      mode: 'characters',
      start_char: offset,
      end_char: next,
      total_chars: source.length,
      truncated: next < source.length,
      next_start_char: next < source.length ? next : null,
    };
  }

  const lines = source ? source.split('\n') : [];
  const firstLine = Math.max(1, Number(start_line) || 1);
  const requestedEnd = end_line === undefined || end_line === null
    ? firstLine + 119
    : Math.max(firstLine, Number(end_line) || firstLine);
  const lastLine = Math.min(lines.length, requestedEnd);
  const startOffset = firstLine <= lines.length
    ? lines.slice(0, firstLine - 1).reduce((total, line) => total + line.length + 1, 0)
    : source.length;
  const requestedText = lines.slice(firstLine - 1, lastLine).join('\n');
  const page = requestedText.slice(0, charLimit);
  const endOffset = startOffset + page.length;
  const cutInsideRange = page.length < requestedText.length;
  const hasMoreLines = lastLine < lines.length;

  return {
    content: page,
    mode: 'lines',
    start_line: firstLine,
    end_line: lastLine,
    total_lines: lines.length,
    total_chars: source.length,
    truncated: cutInsideRange || hasMoreLines,
    next_start_line: !cutInsideRange && hasMoreLines ? lastLine + 1 : null,
    next_start_char: cutInsideRange ? endOffset : null,
  };
}

export async function listFiles({ owner, repo, path, branch, ref }) {
  const revision = requestedRef({ ref, branch });
  const query = revision ? `?ref=${encodeURIComponent(revision)}` : '';
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path || ''}${query}`
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  if (!Array.isArray(data)) return [{ name: data.name, path: data.path, type: data.type }];
  return data.map((item) => ({ name: item.name, path: item.path, type: item.type }));
}

export async function readFile({ owner, repo, path, branch, ref, start_line, end_line, start_char, max_chars }) {
  const revision = requestedRef({ ref, branch });
  const query = revision ? `?ref=${encodeURIComponent(revision)}` : '';
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path}${query}`
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  if (Array.isArray(data)) throw new Error(`Path is a directory, not a file: ${path}`);
  const content = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '';
  return {
    path,
    sha: data.sha,
    ref: revision || null,
    ...pageFileContent(content, { start_line, end_line, start_char, max_chars }),
  };
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

export function findCatastrophicDiffs(files = []) {
  return files.filter((file) => {
    const additions = Number(file.additions) || 0;
    const deletions = Number(file.deletions) || 0;
    const changes = Number(file.changes) || additions + deletions;
    return file.status === 'modified' && deletions >= 200 && deletions > additions * 2 && deletions / Math.max(changes, 1) >= 0.7;
  }).map((file) => ({
    path: file.filename,
    additions: Number(file.additions) || 0,
    deletions: Number(file.deletions) || 0,
    changes: Number(file.changes) || 0,
  }));
}

export async function inspectBranchDiff({ owner, repo, head, base }) {
  if (!head) throw new Error('head branch is required');
  const baseBranch = base || (await getDefaultBranch(owner, repo));
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(head)}`
  );
  if (!ok) throw new Error(`GitHub API error comparing branches (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  const files = (data.files || []).map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
  }));
  return {
    base: baseBranch,
    head,
    ahead_by: data.ahead_by,
    behind_by: data.behind_by,
    total_commits: data.total_commits,
    files,
    catastrophic_diffs: findCatastrophicDiffs(files),
  };
}

export async function createPullRequest({ owner, repo, title, head, base, body: prBody }) {
  const baseBranch = base || (await getDefaultBranch(owner, repo));
  const inspection = await inspectBranchDiff({ owner, repo, head, base: baseBranch });
  if (inspection.catastrophic_diffs.length) {
    const summary = inspection.catastrophic_diffs
      .map((file) => `${file.path} (+${file.additions}/-${file.deletions})`)
      .join(', ');
    throw new Error(`PR_SAFETY_BLOCKED: catastrophic deletion pattern detected: ${summary}. Repair the branch and rerun relevant tests before opening a PR.`);
  }
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
    diff_inspected: true,
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

export async function listPullRequests({ owner, repo, state = 'open' } = {}) {
  const results = [];
  let page = 1;
  while (true) {
    const { ok, status, data } = await githubRequest(
      `/repos/${owner}/${repo}/pulls?state=${encodeURIComponent(state)}&per_page=100&page=${page}`
    );
    if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return results.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: Boolean(pr.draft),
    user: pr.user?.login,
    head: pr.head?.ref,
    base: pr.base?.ref,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    html_url: pr.html_url,
  }));
}

// Which files a PR actually touches — the missing piece that would have
// caught #99 and #103 both rewriting public/nex-chat-bar.js independently
// before either merged.
export async function listPullRequestFiles({ owner, repo, pr_number }) {
  const results = [];
  let page = 1;
  while (true) {
    const { ok, status, data } = await githubRequest(
      `/repos/${owner}/${repo}/pulls/${pr_number}/files?per_page=100&page=${page}`
    );
    if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data.map((f) => f.filename));
    if (data.length < 100) break;
    page++;
  }
  return results;
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
    const existing = await getFileState(owner, repo, file.path, targetBranch);
    if (existing) assertSafeFileReplacement(existing.content, file.content, { path: file.path });
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
