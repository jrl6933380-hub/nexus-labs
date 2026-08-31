// /lib/nexBrain.js
// Nex's core "ask him something and get a real answer" logic — shared
// by the visible chat endpoint (api/chat.js) and the private testing
// lane (api/claude-message.js). Single source of truth for the TOOLS
// list, tool dispatch, and the Claude API call, so both callers behave
// identically and a fix here fixes both at once.

import fs from 'fs';
import path from 'path';
import { listMemories, addMemory } from './memory.js';
import { listFiles, readFile, createBranch, createPullRequest } from './github.js';
import { addToQueue } from './queue.js';

const MODEL_TIERS = {
  cheap: 'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-5',
  heavy: 'claude-opus-5',
};
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

async function classifyTier(message) {
  try {
    const response = await fetch(CLAUDE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_TIERS.cheap,
        max_tokens: 10,
        system:
          'Classify the message into exactly one word: "cheap" for casual chit-chat/small talk/simple questions, "standard" for real work like coding, building sites, or planning, "heavy" for genuinely complex multi-step reasoning or hard architectural decisions. Reply with only that one word, nothing else.',
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!response.ok) {
      console.error('classifyTier: bad response', response.status);
      return 'standard';
    }

    const data = await response.json();
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
      },
      required: ['content'],
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
    name: 'create_repo_file',
    description: 'Propose creating a new file in a GitHub repo (or overwriting it if it already exists). This does NOT execute immediately — it adds the proposed change to Mr. Lopez\'s approval queue on the dashboard, and only actually happens once he taps Approve there.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string', description: 'File path within the repo, e.g. "api/chat.js".' },
        content: { type: 'string', description: 'Full file contents.' },
        message: { type: 'string', description: 'Commit message. Optional.' },
        branch: { type: 'string' },
        description: { type: 'string', description: 'A short, plain-English summary of what this change does and why, shown to Mr. Lopez in the approval queue.' },
      },
      required: ['owner', 'repo', 'path', 'content'],
    },
  },
  {
    name: 'update_repo_file',
    description: 'Propose overwriting an existing file in a GitHub repo with new content. This does NOT execute immediately — it adds the proposed change to Mr. Lopez\'s approval queue on the dashboard, and only actually happens once he taps Approve there.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string' },
        message: { type: 'string' },
        branch: { type: 'string' },
        description: { type: 'string', description: 'A short, plain-English summary of what this change does and why, shown to Mr. Lopez in the approval queue.' },
      },
      required: ['owner', 'repo', 'path', 'content'],
    },
  },
  {
    name: 'delete_repo_file',
    description: 'Propose deleting a file from a GitHub repo. This does NOT execute immediately — it adds the proposed deletion to Mr. Lopez\'s approval queue on the dashboard, and only actually happens once he taps Approve there.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string' },
        message: { type: 'string' },
        branch: { type: 'string' },
        description: { type: 'string', description: 'A short, plain-English summary of why this file should be deleted, shown to Mr. Lopez in the approval queue.' },
      },
      required: ['owner', 'repo', 'path'],
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
    description: 'Create a new branch in a GitHub repo, branched off an existing branch. Executes immediately (no approval needed) since it never touches the live/default branch — it just makes a safe copy to work on. Use this before making risky or experimental changes, then propose them via create_repo_file/update_repo_file on that branch, then open a pull request with create_pull_request so Mr. Lopez can review the actual diff before it goes live.',
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
];

async function callClaude(model, history, identityText, memoriesText) {
  const systemPrompt = `${identityText}\n\n## What I remember long-term:\n${memoriesText || '(nothing saved yet)'}\n\n## Important: always include a short text reply to Mr. Lopez, even when you also call a tool. Never respond with a tool call and nothing else.\n\n## Critical: never claim to have done something unless you actually called the corresponding tool in this exact turn and it succeeded. For create_repo_file, update_repo_file, delete_repo_file, create_repo, and delete_repo specifically: calling these tools only PROPOSES the change and adds it to the approval queue — it does not execute yet. Tell Mr. Lopez it's queued for his approval, not that it's done. create_branch and create_pull_request are different — those DO execute immediately, since they never touch the live/default branch.\n\n## When editing an existing file with update_repo_file, use read_repo_file first if you're not already certain exactly what it currently contains — never guess at existing code.\n\n## delete_repo is irreversible once approved. Only propose it when Mr. Lopez has explicitly and clearly named the specific repo to delete — never suggest or propose it on your own initiative.\n\n## If you genuinely cannot do something because a tool is missing or broken (a real capability wall, not just a hard question), save_memory it with category "for_claude" so Claude picks it up when he's next in a session — but only for real capability gaps, not routine tasks.`;

  const claudeMessages = history
    .filter((msg) => typeof msg.content === 'string' && msg.content.trim().length > 0)
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    }));

  async function send(messages) {
    const response = await fetch(CLAUDE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || contentType.includes('text/html')) {
      const errorText = await response.text();
      console.error('Claude rejected the request:', errorText);
      throw new Error('Claude API returned an error response.');
    }
    return response.json();
  }

  let messages = claudeMessages;
  let data = await send(messages);

  while (data.stop_reason === 'tool_use') {
    const toolUseBlocks = data.content.filter((block) => block.type === 'tool_use');
    const toolResults = [];

    for (const block of toolUseBlocks) {
      if (block.name === 'save_memory') {
        try {
          const memory = await addMemory(block.input.content, block.input.category);
          console.log('save_memory tool: saved', memory.id, 'category', memory.category);
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
      } else if (block.name === 'create_repo_file' || block.name === 'update_repo_file') {
        try {
          const item = await addToQueue({
            tool: block.name,
            input: block.input,
            description: block.input.description,
          });
          console.log(block.name, 'tool: queued', block.input.path, 'id', item.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Proposed and added to the approval queue (not yet executed — waiting for Mr. Lopez to approve): ${item.description}`,
          });
        } catch (err) {
          console.error(block.name, 'tool failed to queue:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to queue proposed change: ${err.message}`,
            is_error: true,
          });
        }
      } else if (block.name === 'delete_repo_file') {
        try {
          const item = await addToQueue({
            tool: block.name,
            input: block.input,
            description: block.input.description || `Delete ${block.input.path}`,
          });
          console.log('delete_repo_file tool: queued', block.input.path, 'id', item.id);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Proposed deletion added to the approval queue (not yet executed — waiting for Mr. Lopez to approve): ${item.description}`,
          });
        } catch (err) {
          console.error('delete_repo_file tool failed to queue:', err.message, 'input was:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Failed to queue proposed deletion: ${err.message}`,
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
      }
    }

    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      { role: 'user', content: toolResults },
    ];
    data = await send(messages);
  }

  const textBlock = data?.content?.find((block) => block.type === 'text');
  const reply = textBlock?.text;

  if (!reply) {
    console.error('Claude returned no text block on', model, '— escalating to next tier:', JSON.stringify(data).slice(0, 500));

    if (model === MODEL_TIERS.cheap) {
      return callClaude(MODEL_TIERS.standard, history, identityText, memoriesText);
    }
    if (model === MODEL_TIERS.standard) {
      return callClaude(MODEL_TIERS.heavy, history, identityText, memoriesText);
    }

    throw new Error('Claude returned no text even after escalating through all tiers.');
  }

  return reply;
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
// askNex — the single entry point both callers use. Takes a message
// and whatever history the caller wants included (or none), and
// returns Nex's real reply, having actually run through his identity,
// his memory, and his tools. The caller decides what to do with the
// result — save it to the visible chat, or just read it and discard.
// ============================================================
export async function askNex(message, history = []) {
  if (!CLAUDE_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY environment variable.');

  const identityText = loadIdentity();
  const memories = await listMemories();
  const memoriesText = memories.map((m) => `- [${m.category}] ${m.content}`).join('\n');

  const updatedHistory = [...history, { role: 'user', content: message }];

  const tier = await classifyTier(message);
  const model = MODEL_TIERS[tier];
  const reply = await callClaude(model, updatedHistory, identityText, memoriesText);

  return { reply, updatedHistory };
}
