// /lib/nexBrain.js
// Nex's core "ask him something and get a real answer" logic — shared
// by the visible chat endpoint (api/chat.js) and the private testing
// lane (api/claude-message.js). Single source of truth for the TOOLS
// list, tool dispatch, and the Claude API call, so both callers behave
// identically and a fix here fixes both at once.

import fs from 'fs';
import path from 'path';
import { searchMemories, addMemory, updateMemory, deleteMemory } from './memory.js';
import { listFiles, readFile, listRepos, createBranch, createPullRequest, searchCode, commitFiles, createOrUpdateFile, deleteFile, getDefaultBranch, readIssue, readPullRequest } from './github.js';
import { addToQueue } from './queue.js';
import { readBoard, createTask, claimTask, updateProgress, markBlocked, completeTask, postMessage } from './board.js';
import { wakeClaudeForTask } from './claudeHandoff.js';
import { runInSandbox } from './sandbox.js';
import { AllProvidersUnavailableError, routeMessage } from './modelRouter.js';
import { loadFreshSnapshot, selectSnapshotContext } from './systemSnapshot.js';
import { getNexRuntimePolicy } from './nexRuntimePolicy.js';

export const MODEL_TIERS = {
  cheap: 'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-5',
  heavy: 'claude-opus-5',
};

// Friendly display names, keyed by the actual model string returned
// from the API — used by the frontend to show "who answered" without
// needing to know the raw model ids.
export const MODEL_DISPLAY_NAMES = {
  [MODEL_TIERS.cheap]: 'Haiku',
  [MODEL_TIERS.standard]: 'Sonnet',
  [MODEL_TIERS.heavy]: 'Opus',
};

// Real safety gate for the "build mode" behavior — NOT a prompt-level
// promise. A file-write tool only ever executes immediately if it
// names a branch that is provably NOT the repo's actual live/default
// branch (checked against GitHub itself, never guessed). No branch
// specified defaults to the live branch on GitHub's side, so that's
// treated as live too. This function is the one thing standing
// between "Nex feels confident" and "a file changes on a live site
// with nobody's approval" — nothing about conversation history or
// what Nex was just told can skip it.
async function isLiveBranch(owner, repo, branch) {
  if (!branch) return true;
  const defaultBranch = await getDefaultBranch(owner, repo);
  return branch === defaultBranch;
}

async function classifyTier(message) {
  try {
    const { data } = await routeMessage({
      tier: 'cheap',
      claudeModel: MODEL_TIERS.cheap,
      body: {
        max_tokens: 10,
        system:
          'Classify the message into exactly one word: "cheap" for casual chit-chat/small talk/simple questions, "standard" for real work like coding, building sites, or planning, "heavy" for genuinely complex multi-step reasoning or hard architectural decisions. Reply with only that one word, nothing else.',
        messages: [{ role: 'user', content: message }],
      },
    });
    const textBlock = data?.content?.find((block) => block.type === 'text');
    const word = textBlock?.text?.trim().toLowerCase();

    if (word && MODEL_TIERS[word]) {
      console.log('classifyTier: routed to', word);
      return word;
    }
    return 'standard';
  } catch (err) {
    console.error('classifyTier: threw', err.message);
    return 'standard';
  }
}

const TOOLS = [
  {
    name: 'save_memory',
    description:
      "Save a durable fact worth remembering long-term. Use category \"fact\" for general info/preferences about Mr. Lopez or how Nex should operate, \"project\" for notes tied to a specific client project, or \"for_claude\" specifically when you hit a real capability wall — something you genuinely cannot do because a tool is missing or broken — so Claude can pick it up and help fix it next time he's in a session. Only call this for things genuinely worth recalling, not casual chit-chat.",
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact to remember, written clearly and standalone (should make sense read alone, out of context).',
        },
        category: {
          type: 'string',
          enum: ['fact', 'project', 'for_claude'],
          description: '"fact" for general info/preferences. "project" for a specific client project. "for_claude" for a capability wall you hit that needs Claude\'s help to fix.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional — 2-5 short topic tags (e.g. ["vercel","billing"]) to help this memory surface later for the right questions. If omitted, tags are auto-derived from the content.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'update_memory',
    description: "Edit one of your own existing memories by id — correct something inaccurate, or update it as things change. List what you remember by checking your own memory context above; you'll need the exact id, which isn't shown there — ask Mr. Lopez to check the memory dashboard if you don't already know it from earlier in this conversation.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the memory to update.' },
        content: { type: 'string', description: 'New content. Omit to leave unchanged.' },
        category: { type: 'string', enum: ['fact', 'project', 'for_claude'], description: 'New category. Omit to leave unchanged.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags. Omit to leave unchanged.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_memory',
    description: 'Permanently delete one of your own memories by id. Use this to remove something incorrect, resolved, or no longer relevant.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the memory to delete.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_repo_files',
    description: 'List files in a GitHub repo directory (or the whole repo root if no path given). Use this to see what exists before creating or editing files.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (GitHub username or org).' },
        repo: { type: 'string', description: 'Repo name.' },
        path: { type: 'string', description: 'Folder path. Leave empty for repo root.' },
        branch: { type: 'string', description: 'Branch name. Defaults to the repo default branch.' },
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
        owner: { type: 'string', description: 'Optional — filter to repos owned by this GitHub username or org. Omit to see every repo the connected account can see.' },
      },
    },
  },
  {
    name: 'read_repo_file',
    description: 'Read the full current contents of a single file in a GitHub repo. Use this before update_repo_file whenever you are not certain exactly what the file currently contains — never guess at existing code, always read it first.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (GitHub username or org).' },
        repo: { type: 'string', description: 'Repo name.' },
        path: { type: 'string', description: 'File path within the repo, e.g. "api/chat.js".' },
        branch: { type: 'string', description: 'Branch name. Defaults to the repo default branch.' },
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
    name: 'create_repo_file',
    description: 'Create a new file in a GitHub repo (or overwrite it if it already exists). BEHAVIOR DEPENDS ON `branch`: if `branch` is omitted or is the repo\'s actual live/default branch, this only PROPOSES the change — it\'s added to Mr. Lopez\'s approval queue and only actually happens once he taps Approve. If `branch` names any OTHER branch (checked for real against GitHub, not guessed), it writes immediately — safe, since that branch can\'t be live. Use create_branch first to get one, then write to it freely, then create_pull_request when ready for Mr. Lopez to review the actual diff.',
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
    description: 'Overwrite an existing file in a GitHub repo with new content. BEHAVIOR DEPENDS ON `branch`: if `branch` is omitted or is the repo\'s actual live/default branch, this only PROPOSES the change — added to Mr. Lopez\'s approval queue, only happens once he taps Approve. If `branch` names any OTHER branch (checked for real against GitHub), it writes immediately. Use create_branch first, write freely to it, then create_pull_request when ready for review.',
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
    name: 'delete_repo_file',
    description: 'Delete a file from a GitHub repo. BEHAVIOR DEPENDS ON `branch`: if `branch` is omitted or is the repo\'s actual live/default branch, this only PROPOSES the deletion — added to Mr. Lopez\'s approval queue. If `branch` names any OTHER branch (checked for real against GitHub), it deletes immediately.',
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
    description: "Create, update, or delete MULTIPLE files in a GitHub repo as one single atomic commit. BEHAVIOR DEPENDS ON `branch`: if `branch` is omitted or is the repo's actual live/default branch, this only PROPOSES the batch — added to Mr. Lopez's approval queue. If `branch` names any OTHER branch (checked for real against GitHub), it commits immediately. Use this whenever a change touches more than one file, so it lands as one clean commit instead of several separate ones.",
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
  {
    name: 'create_repo',
    description: 'Propose creating a brand new GitHub repository. This does NOT execute immediately — it adds the proposed repo to Mr. Lopez\'s approval queue on the dashboard, and only actually gets created once he taps Approve there. Use this before creating files when the target repo does not exist yet.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner — should match the connected GitHub account.' },
        name: { type: 'string', description: 'Name for the new repository.' },
        description: { type: 'string', description: 'Short description of the repo itself (what it is for).' },
        private: { type: 'boolean', description: 'Whether the repo should be private. Defaults to false (public).' },
      },
      required: ['owner', 'name'],
    },
  },
  {
    name: 'delete_repo',
    description: 'Propose deleting an ENTIRE GitHub repository. This is irreversible once approved — GitHub does not support undoing it. This does NOT execute immediately — it adds the proposal to Mr. Lopez\'s approval queue, and only actually happens once he taps Approve there. Only propose this when Mr. Lopez has clearly and explicitly asked for a specific repo to be deleted — never suggest this proactively.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string', description: 'Repo name to delete.' },
        description: { type: 'string', description: 'A short summary of why this repo is being deleted, shown to Mr. Lopez in the approval queue.' },
      },
      required: ['owner', 'repo'],
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
    name: 'create_pull_request',
    description: 'Open a pull request proposing to merge one branch into another. Executes immediately (no approval needed) since opening a PR does not merge anything — it just proposes the change for review on GitHub, which Mr. Lopez can look at and merge himself when ready. Use this after staging changes on a branch.',
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
    description: 'Run up to 8 shell commands in one fresh, isolated E2B sandbox and return stdout, stderr, and exit codes. Use this to install dependencies, run tests, lint, or verify branch work before opening a pull request. The sandbox is destroyed after this call; never put credentials, secrets, or production data into commands.',
    input_schema: {
      type: 'object',
      properties: {
        commands: { type: 'array', items: { type: 'string' }, description: 'Commands to run in order in the same temporary sandbox.' },
        timeoutMs: { type: 'number', description: 'Sandbox lifetime in milliseconds, clamped to 1,000–60,000.' },
      },
      required: ['commands'],
    },
  },
  {
    name: 'read_board',
    description: "Read the shared Agent Board — every task Claude, GPT, or Nex has created, its status and owner, plus recent messages posted between agents. Check this before creating a task or claiming one, so you don't collide with work already in progress. Executes immediately.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_board_task',
    description: "Create a new task on the shared Agent Board, visible to Claude, GPT, and Nex. This is real inter-agent coordination, not a change to Mr. Lopez's files or repos, so it executes immediately and does not go through the approval queue. Use this before starting real work another agent might also pick up, so everyone can see it.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title.' },
        description: { type: 'string', description: 'More detail on what the task involves.' },
        owner: { type: 'string', description: 'Who is doing this, e.g. "nex", "claude", "chatgpt". Omit to leave unclaimed.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'claim_board_task',
    description: 'Claim an existing task on the Agent Board as your own, so other agents know not to also start it. Executes immediately.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id to claim.' },
        owner: { type: 'string', description: 'Who is claiming it — use "nex".' },
      },
      required: ['id', 'owner'],
    },
  },
  {
    name: 'update_board_task_progress',
    description: 'Update the status and/or leave a short progress note on a task you own on the Agent Board — e.g. moving it from "planning" to "building" or "testing". Executes immediately. Valid statuses: idle, planning, building, testing, blocked, waiting_for_justin, complete.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id to update.' },
        status: { type: 'string', enum: ['idle', 'planning', 'building', 'testing', 'blocked', 'waiting_for_justin', 'complete'], description: 'New status. Omit to leave unchanged.' },
        note: { type: 'string', description: 'Short progress note. Omit to leave unchanged.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mark_board_task_blocked',
    description: 'Mark a task you own as blocked on the Agent Board, with a reason — so Claude or Mr. Lopez knows to step in. Executes immediately.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id to mark blocked.' },
        reason: { type: 'string', description: 'Why the task is blocked.' },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'complete_board_task',
    description: 'Mark a task as complete on the Agent Board, optionally attaching a short final result summary. Executes immediately.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id to complete.' },
        result: { type: 'string', description: 'A short summary of what was done, shown on the board.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'post_board_message',
    description: 'Post a short message to the shared Agent Board log, visible to Claude, GPT, and Nex — e.g. "about to edit lib/board.js, hold off" — so everyone stays coordinated in real time, not just through task status. Executes immediately, and always posts under your own name ("nex").',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to post.' },
      },
      required: ['message'],
    },
  },
  {
    name: 'wake_claude_code',
    description: "Wake a real Claude Code session to pick up and work on something — fires the actual Claude Routine wake mechanism (proven end-to-end in epic task 03), not just a board task nobody comes to work on. This starts a real, billed Claude session, so ONLY call this when Mr. Lopez has explicitly asked you to wake, bring in, or get Claude on something right now — never propose or call this on your own initiative, and never chain it automatically off of some other action. If it's not clear he means right now, ask him first instead of calling this.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the board task this creates, e.g. "Finish the room-timeout test with Justin and ChatGPT".' },
        description: { type: 'string', description: "Real context for the woken Claude session: what's being worked on, what still needs finishing, and anything relevant from this conversation (repo/branch, what's already been tried, what to check first). Write it so a Claude session with no other context can actually pick up the work correctly." },
      },
      required: ['title', 'description'],
    },
  },
];

async function callModel(tier, model, history, identityText, memoriesText, snapshotContext, accumulatedUsage) {
  const usage = accumulatedUsage || { input_tokens: 0, output_tokens: 0 };

  const systemPrompt = `${identityText}\n\n## What I remember long-term:\n${memoriesText || '(nothing saved yet)'}\n\n## Important: always include a short text reply to Mr. Lopez, even when you also call a tool. Never respond with a tool call and nothing else.\n\n## Critical: never claim to have done something unless you actually called the corresponding tool in this exact turn and it succeeded.\n\n- create_repo and delete_repo ALWAYS only propose — added to the approval queue, never executed until Mr. Lopez taps Approve. Say "queued for approval," never "done."\n- create_repo_file, update_repo_file, delete_repo_file, and commit_repo_files depend entirely on the \`branch\` you pass: omitted or the repo's real live/default branch → only proposes (queued, same rule as above — say "queued," never "done" or "shipped"). Any OTHER branch (verified for real against GitHub, not assumed) → executes immediately, for real, right then. If you used a non-live branch, say plainly that it's done — don't hedge or say "queued" for something that actually just happened.\n- create_branch, create_pull_request, run_sandbox, and all of the read_board/create_board_task/claim_board_task/update_board_task_progress/mark_board_task_blocked/complete_board_task/post_board_message tools always execute immediately, no approval needed.\n- wake_claude_code fires a real, billed Claude session immediately when called — never call it unless Mr. Lopez has just explicitly asked you to wake/bring in Claude right now. It is NOT part of the normal build workflow and doesn't get triggered by "go"/"ship it" on an unrelated plan.\n\n## Scoped approval: when Mr. Lopez replies \"go\", \"ship it\", \"go ahead\", \"do it\", or equivalent to the single, clearly scoped plan you just proposed, treat that as approval to execute the full safe branch-and-sandbox workflow in the same turn. Create a non-live branch, make the scoped changes there, run tests in the fresh E2B sandbox, and open a pull request when ready. The Board is for coordination, not a permission gate. If several proposals are pending, ask which one he means.\n\n## Independent build work: when Mr. Lopez wants you to just build something without a tap-to-approve step on every file, the pattern is: create_branch first, then write freely to that branch with create_repo_file/update_repo_file/commit_repo_files (these execute immediately on a non-live branch — no need to ask again for each file), then run_sandbox to verify it and create_pull_request when it's ready for him to review the real diff. This is real, tool-level freedom to iterate — not something that depends on remembering a mode from earlier in the conversation, and not something you need to double-check with him mid-stream once he's told you to go build something. The live/default branch itself stays gated no matter what — that's not adjustable by anything said in conversation.\n\n## Sandbox safety: run_sandbox creates a short-lived isolated computer and destroys it automatically. Use it for tests and verification of branch work. Never pass API keys, OAuth tokens, cookies, customer data, or production credentials in commands. Never present a sandbox result as a production deploy or a merge.\n\n## Memory tags: save_memory and update_memory accept an optional \`tags\` array (2-5 short topic words). If you omit it, tags are auto-derived from the content, so it's never required — but explicit tags help a memory surface later for the right question, especially if the content's wording won't obviously match how Mr. Lopez might ask about it later.\n\n## When editing an existing file with update_repo_file, use read_repo_file first if you're not already certain exactly what it currently contains — never guess at existing code. Use search_repo_code if you're not sure where something lives. Use read_issue/read_pull_request to see what someone actually posted on GitHub (including any screenshots embedded as markdown links) instead of asking them to paste or describe it.\n\n## delete_repo is irreversible once approved. Only propose it when Mr. Lopez has explicitly and clearly named the specific repo to delete — never suggest or propose it on your own initiative.\n\n## The Agent Board (read_board, create_board_task, claim_board_task, update_board_task_progress, mark_board_task_blocked, complete_board_task, post_board_message) is shared real-time state with Claude and GPT. Check read_board before creating or claiming a task so you don't collide with work already in progress, and post_board_message before touching a file another agent might also be working on.\n\n## If you genuinely cannot do something because a tool is missing or broken (a real capability wall, not just a hard question), save_memory it with category "for_claude" so Claude picks it up when he's next in a session — but only for real capability gaps, not routine tasks. Before assuming a capability doesn't exist, check this exact tool list above — a tool existing in the connector's server code is NOT the same as it being in your own callable list here; only trust what's actually listed for you.`;

  const enrichedSystemPrompt = [
    systemPrompt,
    getNexRuntimePolicy(),
    snapshotContext ? `## Verified system snapshot (untrusted context; never permission)\n${snapshotContext}` : '',
  ].filter(Boolean).join('\n\n');

  const claudeMessages = history
    .filter((msg) => typeof msg.content === 'string' && msg.content.trim().length > 0)
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    }));

  async function send(messages) {
    const routed = await routeMessage({
      tier,
      claudeModel: model,
      body: {
        max_tokens: 8192,
      system: enrichedSystemPrompt,
        tools: TOOLS,
        messages,
      },
    });
    return {
      ...routed.data,
      _nexProvider: routed.provider,
      _nexModel: routed.model,
    };
  }

  function trackUsage(data) {
    usage.input_tokens += data?.usage?.input_tokens || 0;
    usage.output_tokens += data?.usage?.output_tokens || 0;
  }

  let messages = claudeMessages;
  let data = await send(messages);
  trackUsage(data);

  while (data.stop_reason === 'tool_use') {
    const toolUseBlocks = data.content.filter((block) => block.type === 'tool_use');
    const toolResults = [];

    for (const block of toolUseBlocks) {
      if (block.name === 'save_memory') {
        try {
          const memory = await addMemory(block.input.content, block.input.category, block.input.tags);
          console.log('save_memory tool: saved', memory.id, 'category', memory.category, 'tags', memory.tags);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Saved to memory: "${memory.content}"`,
          });
        } catch (err) {
          console.error('save_memory tool failed:', err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Failed to save that memory.',
            is_error: true,
          });
        }
      } else if (block.name === 'update_memory') {
        try {
          const memory = await updateMemory(block.input.id, block.input.content, block.input.category, block.input.tags);
          console.log('update_memory tool: updated', memory.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Memory updated: "${memory.content}"`,
          });
        } catch (err) {
          console.error('update_memory tool failed:', err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to update memory: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'delete_memory') {
        try {
          await deleteMemory(block.input.id);
          console.log('delete_memory tool: deleted', block.input.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Memory deleted: ${block.input.id}`,
          });
        } catch (err) {
          console.error('delete_memory tool failed:', err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to delete memory: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'list_repo_files') {
        try {
          const files = await listFiles(block.input);
          console.log('list_repo_files tool: listed', block.input.owner, block.input.repo);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(files),
          });
        } catch (err) {
          console.error('list_repo_files tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to list files: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'list_repos') {
        try {
          const repos = await listRepos(block.input);
          console.log('list_repos tool: listed repos', block.input?.owner ? `for ${block.input.owner}` : '(all)');
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(repos),
          });
        } catch (err) {
          console.error('list_repos tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to list repos: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'read_repo_file') {
        try {
          const file = await readFile(block.input);
          console.log('read_repo_file tool: read', block.input.owner, block.input.repo, block.input.path);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: file.content || '(file is empty)',
          });
        } catch (err) {
          console.error('read_repo_file tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to read file: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'search_repo_code') {
        try {
          const result = await searchCode(block.input);
          console.log('search_repo_code tool: searched', block.input.owner, block.input.repo, block.input.query);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          console.error('search_repo_code tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to search code: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'read_issue') {
        try {
          const result = await readIssue(block.input);
          console.log('read_issue tool: read', block.input.owner, block.input.repo, '#' + block.input.issue_number);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          console.error('read_issue tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to read issue: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'read_pull_request') {
        try {
          const result = await readPullRequest(block.input);
          console.log('read_pull_request tool: read', block.input.owner, block.input.repo, '#' + block.input.pr_number);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          console.error('read_pull_request tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to read pull request: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'create_repo_file' || block.name === 'update_repo_file') {
        try {
          const live = await isLiveBranch(block.input.owner, block.input.repo, block.input.branch);
          if (live) {
            const item = await addToQueue({
              tool: block.name,
              input: block.input,
              description: block.input.description,
            });
            console.log(block.name, 'tool: queued (targets live branch)', block.input.path, 'id', item.id);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Targets the live branch — only PROPOSED, added to the approval queue (not yet executed — waiting for Mr. Lopez to approve): ${item.description}`,
            });
          } else {
            const result = await createOrUpdateFile(block.input);
            console.log(block.name, 'tool: wrote directly to non-live branch', block.input.branch, block.input.path);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Written immediately to branch "${block.input.branch}" (not the live branch, so no approval was needed): ${JSON.stringify(result)}`,
            });
          }
        } catch (err) {
          console.error(block.name, 'tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'delete_repo_file') {
        try {
          const live = await isLiveBranch(block.input.owner, block.input.repo, block.input.branch);
          if (live) {
            const item = await addToQueue({
              tool: block.name,
              input: block.input,
              description: block.input.description || `Delete ${block.input.path}`,
            });
            console.log('delete_repo_file tool: queued (targets live branch)', block.input.path, 'id', item.id);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Targets the live branch — only PROPOSED, added to the approval queue (not yet executed — waiting for Mr. Lopez to approve): ${item.description}`,
            });
          } else {
            const result = await deleteFile(block.input);
            console.log('delete_repo_file tool: deleted immediately on non-live branch', block.input.branch, block.input.path);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Deleted immediately on branch "${block.input.branch}" (not the live branch, so no approval was needed): ${JSON.stringify(result)}`,
            });
          }
        } catch (err) {
          console.error('delete_repo_file tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'commit_repo_files') {
        try {
          const fileCount = (block.input.files || []).length;
          const live = await isLiveBranch(block.input.owner, block.input.repo, block.input.branch);
          if (live) {
            const item = await addToQueue({
              tool: 'commit_repo_files',
              input: block.input,
              description: block.input.description || `Batch commit: ${fileCount} file(s)`,
            });
            console.log('commit_repo_files tool: queued (targets live branch)', fileCount, 'files, id', item.id);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Targets the live branch — only PROPOSED, added to the approval queue (not yet executed — waiting for Mr. Lopez to approve): ${item.description}`,
            });
          } else {
            const result = await commitFiles(block.input);
            console.log('commit_repo_files tool: committed immediately to non-live branch', block.input.branch, fileCount, 'files');
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Committed immediately to branch "${block.input.branch}" (not the live branch, so no approval was needed): ${JSON.stringify(result)}`,
            });
          }
        } catch (err) {
          console.error('commit_repo_files tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'create_repo') {
        try {
          const item = await addToQueue({
            tool: block.name,
            input: block.input,
            description: block.input.description || `Create new repo: ${block.input.name}`,
          });
          console.log('create_repo tool: queued', block.input.name, 'id', item.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Proposed new repo added to the approval queue (not yet created — waiting for Mr. Lopez to approve): ${item.description}`,
          });
        } catch (err) {
          console.error('create_repo tool failed to queue:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to queue proposed repo: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'delete_repo') {
        try {
          const item = await addToQueue({
            tool: block.name,
            input: block.input,
            description: block.input.description || `Delete entire repo: ${block.input.repo}`,
          });
          console.log('delete_repo tool: queued', block.input.repo, 'id', item.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Proposed repo deletion added to the approval queue (not yet executed — irreversible once approved, waiting for Mr. Lopez to approve): ${item.description}`,
          });
        } catch (err) {
          console.error('delete_repo tool failed to queue:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to queue proposed repo deletion: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'create_branch') {
        try {
          const result = await createBranch(block.input);
          console.log('create_branch tool: created', block.input.branch, 'on', block.input.owner, block.input.repo);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Branch created: ${JSON.stringify(result)}`,
          });
        } catch (err) {
          console.error('create_branch tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to create branch: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'create_pull_request') {
        try {
          const result = await createPullRequest(block.input);
          console.log('create_pull_request tool: opened PR', result.number, 'on', block.input.owner, block.input.repo);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Pull request opened: ${JSON.stringify(result)}`,
          });
        } catch (err) {
          console.error('create_pull_request tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to open pull request: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'run_sandbox') {
        try {
          const result = await runInSandbox(block.input);
          console.log('run_sandbox tool: completed', block.input.commands.length, 'command(s)');
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Sandbox completed (fresh sandbox destroyed after run): ${JSON.stringify(result)}`,
          });
        } catch (err) {
          console.error('run_sandbox tool failed:', err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Sandbox failed: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'read_board') {
        try {
          const board = await readBoard();
          console.log('read_board tool: read board,', board.tasks.length, 'tasks,', board.messages.length, 'messages');
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(board),
          });
        } catch (err) {
          console.error('read_board tool failed:', err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to read board: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'create_board_task') {
        try {
          const task = await createTask(block.input);
          console.log('create_board_task tool: created', task.id, task.title);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Task created on the board: ${JSON.stringify(task)}`,
          });
        } catch (err) {
          console.error('create_board_task tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to create board task: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'claim_board_task') {
        try {
          const task = await claimTask(block.input);
          console.log('claim_board_task tool: claimed', task.id, 'for', block.input.owner);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Task claimed: ${JSON.stringify(task)}`,
          });
        } catch (err) {
          console.error('claim_board_task tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to claim board task: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'update_board_task_progress') {
        try {
          const task = await updateProgress(block.input);
          console.log('update_board_task_progress tool: updated', task.id, task.status);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Task updated: ${JSON.stringify(task)}`,
          });
        } catch (err) {
          console.error('update_board_task_progress tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to update board task: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'mark_board_task_blocked') {
        try {
          const task = await markBlocked(block.input);
          console.log('mark_board_task_blocked tool: blocked', task.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Task marked blocked: ${JSON.stringify(task)}`,
          });
        } catch (err) {
          console.error('mark_board_task_blocked tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to mark board task blocked: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'complete_board_task') {
        try {
          const task = await completeTask(block.input);
          console.log('complete_board_task tool: completed', task.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Task marked complete: ${JSON.stringify(task)}`,
          });
        } catch (err) {
          console.error('complete_board_task tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to complete board task: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'post_board_message') {
        try {
          const entry = await postMessage({ from: 'nex', message: block.input.message });
          console.log('post_board_message tool: posted');
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Message posted to board: ${JSON.stringify(entry)}`,
          });
        } catch (err) {
          console.error('post_board_message tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to post board message: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'wake_claude_code') {
        try {
          const { task, wake } = await wakeClaudeForTask(block.input);
          console.log('wake_claude_code tool: fired', task.id, wake.session_url, wake.replayed ? '(replayed)' : '(new)');
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Claude Code woken for board task ${task.id}: ${wake.session_url}${wake.replayed ? ' (this exact task already had a session running — returned the existing one instead of starting a second)' : ''}`,
          });
        } catch (err) {
          console.error('wake_claude_code tool failed:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to wake Claude Code: ${err.message}`,
            is_error: true,
          });
        }
      } else {
        console.error('Unrecognized tool call:', block.name, 'input was:', JSON.stringify(block.input));
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        });
      }
    }

    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      { role: 'user', content: toolResults },
    ];
    data = await send(messages);
    trackUsage(data);
  }

  const textBlock = data?.content?.find((block) => block.type === 'text');
  const reply = textBlock?.text;

  if (!reply) {
    console.error('Claude returned no text block on', model, '— escalating to next tier:', JSON.stringify(data).slice(0, 500));

    // Usage from this failed attempt still cost real money — carry it
    // forward into the escalated attempt's total rather than losing it.
    if (model === MODEL_TIERS.cheap) {
      return callModel('standard', MODEL_TIERS.standard, history, identityText, memoriesText, snapshotContext, usage);
    }
    if (model === MODEL_TIERS.standard) {
      return callModel('heavy', MODEL_TIERS.heavy, history, identityText, memoriesText, snapshotContext, usage);
    }

    throw new Error('Claude returned no text even after escalating through all tiers.');
  }

  return {
    reply,
    model: data._nexModel || data.model || model,
    provider: data._nexProvider || 'anthropic',
    usage,
  };
}

function loadIdentity() {
  const identityPath = path.join(process.cwd(), 'IDENTITY.md');
  try {
    if (fs.existsSync(identityPath)) {
      return fs.readFileSync(identityPath, 'utf-8');
    }
  } catch (fileErr) {
    // fall through to default
  }
  return 'You are Nex, an AI agent inside Nexus Hub.';
}

// ============================================================
// askNex — the single entry point both callers use. Takes a message,
// whatever history the caller wants included, and an optional forced
// tier ('cheap' | 'standard' | 'heavy') to skip auto-routing — pass
// null/omit for the normal auto-classify behavior. Returns Nex's real
// reply, which model actually answered (may differ from what was
// requested if it had to escalate), and token usage for this turn.
// ============================================================
export async function askNex(message, history = [], forcedTier = null) {
  const identityText = loadIdentity();
  const memories = await searchMemories(message);
  const memoriesText = memories.map((m) => `- [${m.category}] ${m.content}`).join('\n');
  let snapshotContext = '';
  try {
    const fresh = await loadFreshSnapshot();
    if (fresh.snapshot) {
      snapshotContext = JSON.stringify(selectSnapshotContext(fresh.snapshot, ['source', 'project', 'repositories', 'capabilities', 'architecture', 'verification']));
    }
  } catch (snapshotError) {
    console.error('askNex: snapshot unavailable, continuing from source of truth:', snapshotError.message);
  }

  const updatedHistory = [...history, { role: 'user', content: message }];

  const tier = forcedTier && MODEL_TIERS[forcedTier] ? forcedTier : await classifyTier(message);
  const model = MODEL_TIERS[tier];
  try {
    const result = await callModel(tier, model, updatedHistory, identityText, memoriesText, snapshotContext);
    return {
      reply: result.reply,
      updatedHistory,
      model: result.model,
      provider: result.provider,
      usage: result.usage,
      degraded: result.provider !== 'anthropic',
    };
  } catch (error) {
    if (!(error instanceof AllProvidersUnavailableError)) throw error;

    console.error('Nex entered safe mode:', JSON.stringify(error.attempts));
    return {
      reply:
        'I’m still online, but every reasoning provider is temporarily unavailable. ' +
        'I’m staying in safe mode and won’t start additional work until a provider returns. ' +
        'Check the Board or approval queue for anything already recorded, then retry shortly.',
      updatedHistory,
      model: 'nex-safe',
      provider: 'none',
      usage: { input_tokens: 0, output_tokens: 0 },
      degraded: true,
    };
  }
}
