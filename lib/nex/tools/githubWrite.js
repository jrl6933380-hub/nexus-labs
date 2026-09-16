// /lib/nex/tools/githubWrite.js
// GitHub file-WRITE tool schemas, split out of lib/nexBrain.js.
// Pure move: these objects are byte-for-byte what TOOLS already contained,
// and are spread back into TOOLS at their original position.
//
// Nothing about the live/default-branch approval gate lives here. That gate
// is enforced in the dispatch logic (isLiveBranch + the approval queue) and
// in MAY_WRITE_TOOLS — moving these schemas does not and cannot change it.

export const GITHUB_WRITE_TOOLS = [
  {
    name: 'create_repo_file',
    description: 'Create a new file in a GitHub repo. If the path already exists, the server applies the same catastrophic-shrink protection as update_repo_file. BEHAVIOR DEPENDS ON `branch`: if `branch` is omitted or is the repo\'s actual live/default branch, this only PROPOSES the change. Any OTHER branch writes immediately. For a targeted change to an existing file, use patch_repo_file instead of reconstructing the whole file.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string', description: 'File path within the repo, e.g. "api/chat.js".' },
        content: { type: 'string', description: 'Full file contents.' },
        message: { type: 'string', description: 'Commit message. Optional.' },
        branch: { type: 'string', description: 'Target branch. Omit or use the live/default branch to queue for approval instead of writing immediately.' },
        description: { type: 'string', description: 'A short, plain-English summary of what this change does and why. Shown in the approval queue if this gets queued.' },
      },
      required: ['owner', 'repo', 'path', 'content'],
    },
  },
  {
    name: 'update_repo_file',
    description: 'Replace an existing file only when you possess its complete current contents. Never use this after a truncated or partial read. The server blocks catastrophic shrinkage even on a non-live branch. Prefer patch_repo_file for normal changes to existing files. Live/default branch writes remain queued for approval; non-live branch writes execute immediately.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string' },
        message: { type: 'string' },
        branch: { type: 'string', description: 'Target branch. Omit or use the live/default branch to queue for approval instead of writing immediately.' },
        description: { type: 'string', description: 'A short, plain-English summary of what this change does and why. Shown in the approval queue if this gets queued.' },
      },
      required: ['owner', 'repo', 'path', 'content'],
    },
  },
  {
    name: 'patch_repo_file',
    description: 'Safely edit targeted sections of an existing file on a NON-LIVE branch without reconstructing the whole file. Each operation replaces an exact string and fails if the expected match count is wrong. Use the sha returned by read_repo_file as expected_sha to prevent stale writes. This is the default editing tool for large or partially-read files; it preserves all unseen content server-side.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string' },
        branch: { type: 'string', description: 'Required non-live branch.' },
        expected_sha: { type: 'string', description: 'SHA from read_repo_file. The patch fails if the file changed since that read.' },
        message: { type: 'string' },
        replacements: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Exact existing text to replace.' },
              replace: { type: 'string', description: 'Replacement text.' },
              expected_occurrences: { type: 'number', description: 'Exact match count expected. Defaults to 1.' },
            },
            required: ['find', 'replace'],
          },
        },
      },
      required: ['owner', 'repo', 'path', 'branch', 'replacements'],
    },
  },
  {
    name: 'delete_repo_file',
    description: 'Delete a file from a GitHub repo. BEHAVIOR DEPENDS ON `branch`: if `branch` is omitted or is the repo\'s actual live/default branch, this only PROPOSES the deletion — added to Mr. Lopez\'s approval queue (dashboard, text, or a yes/go ahead right here — see approve_pending_action). If `branch` names any OTHER branch (checked for real against GitHub), it deletes immediately.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string' },
        message: { type: 'string' },
        branch: { type: 'string', description: 'Target branch. Omit or use the live/default branch to queue for approval instead of deleting immediately.' },
        description: { type: 'string', description: 'A short, plain-English summary of why this file should be deleted. Shown in the approval queue if this gets queued.' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'commit_repo_files',
    description: "Create, update, or delete MULTIPLE files in a GitHub repo as one single atomic commit. BEHAVIOR DEPENDS ON `branch`: if `branch` is omitted or is the repo's actual live/default branch, this only PROPOSES the batch — added to Mr. Lopez's approval queue (dashboard, text, or a yes/go ahead right here — see approve_pending_action). If `branch` names any OTHER branch (checked for real against GitHub), it commits immediately. Use this whenever a change touches more than one file, so it lands as one clean commit instead of several separate ones.",
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        branch: { type: 'string', description: 'Target branch. Omit or use the live/default branch to queue for approval instead of committing immediately.' },
        message: { type: 'string', description: 'Commit message for the whole batch.' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path within the repo.' },
              content: { type: 'string', description: 'Full file contents. Omit this field entirely to delete the file at this path.' },
            },
            required: ['path'],
          },
          description: 'The files to change in this one commit.',
        },
        description: { type: 'string', description: 'A short, plain-English summary of the whole batch. Shown in the approval queue if this gets queued.' },
      },
      required: ['owner', 'repo', 'files'],
    },
  },
];
