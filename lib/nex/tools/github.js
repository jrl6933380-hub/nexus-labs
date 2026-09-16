// Read-only GitHub inspection tool schemas for Nex.
// Pure extraction from lib/nexBrain.js — schemas are byte-for-byte identical to
// the originals; no wording, field, or logic changes. Re-spread into TOOLS.
//
// Scope note: this file holds only the READ-side GitHub tools that were already
// contiguous in TOOLS. The write-side GitHub tools (create_repo_file,
// update_repo_file, patch_repo_file, commit_repo_files, create_branch,
// create_pull_request, merge_pull_request, ...) are interleaved with unrelated
// tools further down the array and are deliberately left in place for a later
// slice, so this move changes no tool ordering.

export const GITHUB_READ_TOOLS = [
  {
    name: 'list_repo_files',
    description: 'List files in a GitHub repo directory (or the whole repo root if no path given). Use this to see what exists before creating or editing files. Pass ref to inspect an exact branch, tag, or commit SHA; branch remains supported as a compatibility alias.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (GitHub username or org).' },
        repo: { type: 'string', description: 'Repo name.' },
        path: { type: 'string', description: 'Folder path. Leave empty for repo root.' },
        branch: { type: 'string', description: 'Branch name. Defaults to the repo default branch.' },
        ref: { type: 'string', description: 'Exact branch, tag, or commit SHA to inspect. Takes precedence over branch.' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'list_repos',
    description: 'List repos visible to the connected GitHub account (owned, collaborator, and org repos, private included), optionally filtered to one owner. Use this to discover whether a repo exists before assuming its name — e.g. checking whether a separate "sandbox" repo exists — instead of only being able to read inside a repo whose exact name you already know.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Optional — filter to repos owned by this GitHub username or org. Omit to see everything visible to the connected account can see.' },
      },
    },
  },
  {
    name: 'read_repo_file',
    description: 'Read a safe page of a single GitHub file with explicit continuation metadata, so large files are never silently cut off. Defaults to 120 lines and at most 6,500 characters. Continue with next_start_line, or with next_start_char when a single requested range is unusually large. Pass ref to read an exact branch, tag, or commit SHA. Use this before update_repo_file whenever you are not certain exactly what the file contains.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (GitHub username or org).' },
        repo: { type: 'string', description: 'Repo name.' },
        path: { type: 'string', description: 'File path within the repo, e.g. "api/chat.js".' },
        branch: { type: 'string', description: 'Branch name. Defaults to the repo default branch.' },
        ref: { type: 'string', description: 'Exact branch, tag, or commit SHA to inspect. Takes precedence over branch.' },
        start_line: { type: 'number', description: '1-based first line. Defaults to 1.' },
        end_line: { type: 'number', description: '1-based final line. Defaults to 120 lines from start_line.' },
        start_char: { type: 'number', description: 'Absolute character offset for continuing an unusually long line/range. Use the returned next_start_char.' },
        max_chars: { type: 'number', description: 'Maximum characters in this page, clamped to 500–7,000. Defaults to 6,500.' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'search_repo_code',
    description: 'Search for code within a specific GitHub repo. Use this to find where something actually lives before guessing at a file or folder path.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (GitHub username or org).' },
        repo: { type: 'string', description: 'Repo name.' },
        query: { type: 'string', description: 'Search terms — a function name, string, filename, or keyword to look for.' },
      },
      required: ['owner', 'repo', 'query'],
    },
  },
  {
    name: 'read_issue',
    description: "Read a GitHub issue's title, body, state, and full comment thread. Use this to see what someone actually posted — including any screenshots, since image links embedded in markdown come through in the raw body/comment text — instead of asking them to paste or describe it.",
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (GitHub username or org).' },
        repo: { type: 'string', description: 'Repo name.' },
        issue_number: { type: 'number', description: 'The issue number to read.' },
      },
      required: ['owner', 'repo', 'issue_number'],
    },
  },
  {
    name: 'read_pull_request',
    description: "Read a pull request's title, body, state, branches, and review-comment thread. Use this to see PR discussion and any embedded screenshots/evidence directly, instead of asking someone to paste or describe it. For the file diff itself, use read_repo_file on the PR's head branch.",
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (GitHub username or org).' },
        repo: { type: 'string', description: 'Repo name.' },
        pr_number: { type: 'number', description: 'The pull request number to read.' },
      },
      required: ['owner', 'repo', 'pr_number'],
    },
  },
  {
    name: 'list_pull_requests',
    description: "List pull requests in a GitHub repo (open by default). Use this before starting new work, or when checking whether something Justin mentioned is already up as a PR — this is also the only way to spot two open PRs that might collide before either merges.",
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (GitHub username or org).' },
        repo: { type: 'string', description: 'Repo name.' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Which PRs to list. Defaults to open.' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'get_workflow_status',
    description: "Read the REAL GitHub Actions/CI check-run status for a commit or an open pull request — pass, fail, still running, and which named check, not just a PR's vague mergeable_state (e.g. \"unstable\" only means SOMETHING isn't green yet, never which check or why). Pass pr_number to check that PR's current head automatically, or pass ref directly for a specific branch/tag/commit SHA. Read-only; this cannot read full raw workflow logs, only each check run's status/conclusion/summary.",
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (GitHub username or org).' },
        repo: { type: 'string', description: 'Repo name.' },
        pr_number: { type: 'number', description: 'Pull request number — resolves to its current head branch automatically. Provide this or ref.' },
        ref: { type: 'string', description: 'A branch name, tag, or commit SHA to check directly. Provide this or pr_number.' },
      },
      required: ['owner', 'repo'],
    },
  },
];

export default GITHUB_READ_TOOLS;
