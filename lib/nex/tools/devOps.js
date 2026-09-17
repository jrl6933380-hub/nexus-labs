// /lib/nex/tools/devOps.js
// Slice 11 of the nexBrain.js TOOLS-array extraction: approval-queue
// read tools, the branch/PR/sandbox build workflow, web search/fetch,
// and the Crash Feed read tools. Pure move — schemas only, verbatim
// from nexBrain.js, no behavior change. Dispatch logic stays in
// nexBrain.js; this file only holds the tool schema declarations.

export const DEV_OPS_TOOLS = [
  {
    name: 'list_pending_actions',
    description: 'List every item currently waiting in the approval queue, oldest first. Read-only: this never approves, rejects, or executes anything. Returns ids, action types, descriptions, targets, and creation times so you can identify the exact proposal before asking Mr. Lopez to approve it.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_pending_action',
    description: 'Read one exact pending approval item by id, including its proposed input/content/diff. Large proposals are returned in explicit character pages; continue with next_start_char until truncated is false. Read-only: this never approves or executes the item. Use it before discussing or approving an older proposal so you do not guess what is queued.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Exact pending queue item id from list_pending_actions.' },
        start_char: { type: 'number', description: 'Absolute character offset for continuing a large proposal. Defaults to 0.' },
        max_chars: { type: 'number', description: 'Maximum characters in this page, clamped to 500–7,000. Defaults to 6,500.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_branch',
    description: 'Create a new branch in a GitHub repo, branched off an existing branch. Executes immediately (no approval needed) since it never touches the live/default branch — it just makes a safe copy to work on. Use this first when starting real independent work: branch, then write to that branch freely with create_repo_file/update_repo_file/commit_repo_files (these execute immediately on a non-live branch — no need to ask again for each file), then open a pull request with create_pull_request so Mr. Lopez can review the actual diff before it goes live.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        branch: { type: 'string', description: 'Name for the new branch.' },
        from_branch: { type: 'string', description: 'Branch to create the new branch from. Defaults to the repo default branch.' },
      },
      required: ['owner', 'repo', 'branch'],
    },
  },
  {
    name: 'inspect_branch_diff',
    description: 'Inspect the complete file-level additions and deletions between a work branch and its base before opening a PR. Always call this after edits and tests and before create_pull_request. If catastrophic_diffs is non-empty, repair the branch instead of opening the PR.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        head: { type: 'string', description: 'Work branch to inspect.' },
        base: { type: 'string', description: 'Base branch. Defaults to the repository default branch.' },
      },
      required: ['owner', 'repo', 'head'],
    },
  },
  {
    name: 'web_search',
    description: "Search the real, current web — not training data. Use this for anything that could have changed since training: current versions, pricing, news, whether a service still exists, verifying a third-party API/library detail before writing code against it. Pass EITHER query (one or more keyword strings) for a direct lookup, OR objective (a natural-language research goal) for a 'find out whether X' style question. Returns dense, ranked excerpts, not full page bodies — use web_fetch afterward if the excerpt isn't enough. See nex-skills/web-search/SKILL.md for full guidance on when this is and isn't worth reaching for.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'array', items: { type: 'string' }, description: 'One or more keyword search strings. Provide this or objective, not necessarily both.' },
        objective: { type: 'string', description: 'A natural-language research goal instead of keywords, e.g. "find out whether X changed their pricing in 2026".' },
        max_results: { type: 'number', description: 'Maximum number of results to return. Optional.' },
      },
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch the actual current content of a specific public URL as clean text — use this after web_search when an excerpt is not enough, or whenever Justin gives a URL directly and wants its real content rather than a guess. Cannot reach logins, paywalls, or private pages.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The public URL to fetch.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Open a pull request after inspect_branch_diff and relevant tests pass. The server independently reinspects the diff and blocks catastrophic deletion patterns such as PR #172. Opening a safe PR executes immediately; merging still requires Mr. Lopez.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string', description: 'Title of the pull request.' },
        head: { type: 'string', description: 'The branch containing the changes (the branch to merge from).' },
        base: { type: 'string', description: 'The branch to merge into. Defaults to the repo default branch.' },
        body: { type: 'string', description: 'Description of the changes, shown on the pull request.' },
      },
      required: ['owner', 'repo', 'title', 'head'],
    },
  },
  {
    name: 'run_sandbox',
    description: 'Run shell commands in a fresh, isolated E2B sandbox and return stdout, stderr, and exit codes. Use this to install dependencies, run tests, lint, or verify branch work before opening a pull request. The sandbox is destroyed after this call; never put credentials, secrets, or production data into commands. Two modes: omit tenant_id/project_id/task_id/agent_id for a simple one-off run (up to 8 commands); provide all four for a scoped, reusable workspace run (up to 32 commands by default, or an explicit max_commands up to 32). network_allowlist and spend_cap_cents are REAL, enforced limits on the scoped path — an allowlist actually restricts what the sandbox can reach over the network, and a spend cap is checked upfront (using E2B\'s real per-second billing rate) and rejected before any sandbox is created if the requested timeout could exceed it.',
    input_schema: {
      type: 'object',
      properties: {
        commands: { type: 'array', items: { type: 'string' }, description: 'Commands to run in order in the same temporary sandbox.' },
        timeoutMs: { type: 'number', description: 'Sandbox lifetime in milliseconds, clamped to 1,000–60,000 for a simple run or up to 3,600,000 for a scoped workspace run. Directly affects worst-case cost against spend_cap_cents on the scoped path.' },
        tenant_id: { type: 'string', description: 'Tenant scope for a reusable workspace run.' },
        project_id: { type: 'string', description: 'Project scope for a reusable workspace run.' },
        task_id: { type: 'string', description: 'Board task scope for a reusable workspace run.' },
        agent_id: { type: 'string', description: 'Worker identity for a reusable workspace run.' },
        network_allowlist: { type: 'array', items: { type: 'string' }, description: 'Hosts the sandbox may reach over the network (scoped runs only). Actually enforced via E2B network policy — everything else is denied once this is set.' },
        public_preview: { type: 'boolean', description: 'Requires network_allowlist to be set (scoped runs only).' },
        spend_cap_cents: { type: 'number', description: 'Maximum allowed cost in cents for this workspace run (scoped runs only). Checked upfront against timeoutMs using E2B\'s real per-second rate; the sandbox is never created if the worst case would exceed this.' },
        template: { type: 'string' },
      },
      required: ['commands'],
    },
  },
  {
    name: 'list_crashes',
    description: 'Read the Nexus Crash Feed: redacted, deduplicated Sentry issues with recurrence, route, deployment, commit, and linked repair task.',
    input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximum crashes to return (1-200).' } } },
  },
  {
    name: 'get_crash',
    description: 'Read one redacted Crash Feed record by id, including recurrence and linked board repair task.',
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Crash Feed record id.' } }, required: ['id'] },
  },
];
