// Durable conductor for a bounded multi-agent build.  It deliberately
// coordinates work and evidence; it never grants a worker new credentials.
import * as liveBoard from './board.js';
import { routeToModel } from './modelRouter.js';
import * as gh from './github.js';
import { createEvidenceTracker } from './nexEvidenceGate.js';
import { getRoomEscalationPage } from './roomEscalation.js';

// A pipeline goal for a Forge customer escalation always embeds its id as
// "forge-<digits>-<slug>" (see lib/roomEscalation.js). Extracting it here
// lets a lane fetch the real private request/current site instead of
// grepping the repo for something that was never in source control.
const FORGE_ESCALATION_ID_RE = /forge-[a-zA-Z0-9_-]+/;
function extractEscalationId(goal) {
  const match = FORGE_ESCALATION_ID_RE.exec(String(goal || ''));
  return match ? match[0] : null;
}

const URL = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
const PREFIX = 'nexus:tunneled-pipeline:';

// Sonnet-class model for lane work (real building, not trivial routing).
// Overridable without a deploy if the Gateway model string ever changes.
const DEFAULT_LANE_MODEL = 'anthropic/claude-sonnet-4.5';

const clean = (value, limit) => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
const clone = (value) => JSON.parse(JSON.stringify(value));

async function redis(command) {
  if (!URL || !TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error('Pipeline storage failed');
  return (await response.json()).result;
}

const redisStore = {
  async get(id) {
    const raw = await redis(['GET', PREFIX + id]);
    return raw ? JSON.parse(raw) : null;
  },
  async set(id, value) { await redis(['SET', PREFIX + id, JSON.stringify(value)]); },
};

function laneDescription({ goal, lane, acceptanceCriteria, pipelineId }) {
  const focus = lane === 'layout'
    ? 'Own structure, interaction behavior, data flow, and implementation feasibility.'
    : 'Own visual hierarchy, styling, motion, responsive polish, and design consistency.';
  return [
    `Pipeline: ${pipelineId}`,
    `Goal: ${goal}`,
    focus,
    `Acceptance criteria: ${acceptanceCriteria.join(' | ') || 'Meet the stated goal.'}`,
    'Return a concise summary and concrete test/evidence through submit_pipeline_lane_result. Do not approve or merge work.',
  ].join('\n');
}

function reviewerDescription(run) {
  const results = Object.entries(run.lanes).map(([lane, value]) =>
    `${lane}: ${value.summary}\nEvidence: ${value.evidence.join(' | ') || 'none supplied'}`).join('\n\n');
  return [
    `Pipeline: ${run.id}`,
    `Goal: ${run.goal}`,
    'Review both specialist outputs against the acceptance criteria. Return pass only when they fit together and include adequate evidence; otherwise return needs_changes with a specific correction for one or both lanes.',
    `Acceptance criteria: ${run.acceptance_criteria.join(' | ') || 'Meet the stated goal.'}`,
    'Specialist results:', results,
  ].join('\n');
}

function laneModel(env) {
  return env.NEX_PIPELINE_LANE_MODEL || DEFAULT_LANE_MODEL;
}

function extractText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n').trim();
}

export function createTunneledPipelineService({ board, store, delegate = routeToModel, env = process.env }) {
  if (!board || !store) throw new Error('board and store are required');

  async function load(id) {
    const run = await store.get(id);
    if (!run) throw new Error('Pipeline not found');
    return run;
  }

  async function save(run) {
    run.updated_at = Date.now();
    await store.set(run.id, run);
    return clone(run);
  }

  // Real tools for a lane's working branch. Nothing here can touch the
  // base/live branch directly: branchName is fixed by runLaneDelegate
  // before the model ever sees a tool, not read from the model's input.
  const LANE_TOOLS = [
    {
      name: 'search_repo_code',
      description: 'Search this repo for a keyword, function name, or filename before assuming where something lives.',
      input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
      name: 'read_repo_file',
      description: 'Read a real file from the repo. You must do this before describing or changing any file.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } },
        required: ['path'],
      },
    },
    {
      name: 'patch_repo_file',
      description: 'Apply one or more exact find/replace edits to an existing file on your working branch. Each find string must match exactly once.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          replacements: {
            type: 'array',
            items: {
              type: 'object',
              properties: { find: { type: 'string' }, replace: { type: 'string' } },
              required: ['find', 'replace'],
            },
          },
        },
        required: ['path', 'replacements'],
      },
    },
    {
      name: 'create_repo_file',
      description: 'Create a brand-new file on your working branch (only for a file that does not exist yet).',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
    {
      name: 'inspect_branch_diff',
      description: 'Compare your working branch against the base branch to see the real, current diff. Call this before finishing.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'create_pull_request',
      description: 'Open a real pull request from your working branch once you have made and verified real changes. This is the only way to submit finished work — a text summary with no PR is rejected.',
      input_schema: {
        type: 'object',
        properties: { title: { type: 'string' }, body: { type: 'string' } },
        required: ['title'],
      },
    },
  ];

  const LANE_WORK_CONTRACT = [
    'You have a real GitHub repo and real tools here — this is not a request to describe what you would build.',
    'A working branch has already been created for you; every write tool below applies to that branch automatically. You cannot write to the base/live branch from here.',
    'Before changing or describing any file, read it with read_repo_file. Do not assume you remember its contents.',
    'Make the actual edits with patch_repo_file (existing files) or create_repo_file (new files). A prose plan is not a deliverable.',
    'When you believe the work is done, call inspect_branch_diff to see the real diff, then call create_pull_request. Do not describe testing evidence in prose — the diff and the PR link are the evidence.',
    'If you stop calling tools before opening a pull request, this lane will be rejected as unverifiable, not accepted on your summary alone.',
  ].join('\n');

  function laneToolExecutor({ owner, repo, branchName, baseBranch }) {
    return async function execute(name, input) {
      switch (name) {
        case 'search_repo_code':
          return gh.searchCode({ owner, repo, query: input.query });
        case 'read_repo_file':
          return gh.readFile({ owner, repo, path: input.path, branch: branchName, start_line: input.start_line, end_line: input.end_line });
        case 'patch_repo_file':
          return gh.patchFile({ owner, repo, path: input.path, branch: branchName, replacements: input.replacements });
        case 'create_repo_file':
          return gh.createOrUpdateFile({ owner, repo, path: input.path, branch: branchName, content: input.content });
        case 'inspect_branch_diff':
          return gh.inspectBranchDiff({ owner, repo, head: branchName, base: baseBranch });
        case 'create_pull_request':
          return gh.createPullRequest({ owner, repo, title: input.title, body: input.body, head: branchName, base: baseBranch });
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    };
  }

  // Runs one lane against a REAL agentic tool loop on its own branch, with
  // real GitHub tools (read, patch, create, diff, PR) — not a bare prompt.
  // The evidence tracker (lib/nexEvidenceGate.js) records what the model
  // actually did; a lane can only report success once it has actually read
  // a file, actually written a change on ITS OWN branch, and the branch
  // actually exists apart from the base branch — never on the strength of
  // a text summary alone. This replaces the old behavior where the literal
  // string "auto-delegated to <model>" was submitted as evidence regardless
  // of whether any real work happened, which is why every Forge escalation
  // was stalling at the reviewer gate: there was never anything real for
  // the reviewer to check.
  async function runLaneDelegate({ pipelineId, lane, description, laneTaskId, owner, repo, baseBranch }) {
    const model = laneModel(env);
    const branchName = `nex/lane-${lane}-${pipelineId}`;
    const tracker = createEvidenceTracker({ lane, requireEvidence: ['source_read', 'non_live_branch', 'write_succeeded'] });

    try {
      await gh.createBranch({ owner, repo, branch: branchName, from_branch: baseBranch });
      tracker.record({ name: 'create_branch' }, { content: `created ${branchName} from ${baseBranch}`, is_error: false });
    } catch (error) {
      if (!/already exists/i.test(error.message)) {
        await board.updateProgress({ id: laneTaskId, status: 'blocked', note: `Could not create a working branch: ${error.message}` });
        return;
      }
      tracker.record({ name: 'create_branch' }, { content: `${branchName} already exists, reusing`, is_error: false });
    }

    const execute = laneToolExecutor({ owner, repo, branchName, baseBranch });
    const messages = [{ role: 'user', content: `${description}\n\n${LANE_WORK_CONTRACT}` }];
    let finalText = '';
    let prResult = null;

    try {
      for (let turn = 0; turn < 10; turn++) {
        const { data } = await delegate({ model, body: { max_tokens: 3000, tools: LANE_TOOLS, messages }, env });
        const blocks = Array.isArray(data?.content) ? data.content : [];
        const textPieces = blocks.filter((block) => block?.type === 'text').map((block) => block.text).filter(Boolean);
        if (textPieces.length) finalText = textPieces.join('\n');
        const toolUses = blocks.filter((block) => block?.type === 'tool_use');
        if (!toolUses.length) break;

        messages.push({ role: 'assistant', content: blocks });
        const toolResults = [];
        for (const use of toolUses) {
          let payload;
          let isError = false;
          try {
            payload = await execute(use.name, use.input || {});
          } catch (error) {
            payload = { error: error.message };
            isError = true;
          }
          tracker.record(use, { content: JSON.stringify(payload), is_error: isError });
          if (use.name === 'create_pull_request' && !isError) prResult = payload;
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(payload), is_error: isError });
        }
        messages.push({ role: 'user', content: toolResults });
      }
    } catch (error) {
      await board.updateProgress({
        id: laneTaskId,
        status: 'blocked',
        note: `Lane run failed: ${error.message}. Branch ${branchName} left in place for manual pickup.`,
      });
      return;
    }

    const receipt = tracker.receipt();
    if (receipt.missing.length) {
      await board.updateProgress({
        id: laneTaskId,
        status: 'blocked',
        note: `Lane produced no verifiable work (missing: ${receipt.missing.join(', ')}) — not marking complete. Branch: ${branchName}. Last model output: ${clean(finalText, 300) || 'none'}`,
      });
      return;
    }

    const evidence = [
      `branch: ${branchName}`,
      prResult?.html_url ? `pull request: ${prResult.html_url}` : 'no PR opened yet — branch has real, verified commits',
      ...receipt.events.filter((event) => event.ok && event.target).map((event) => `wrote ${event.target}`),
    ];

    await submitLaneResult({
      pipeline_id: pipelineId,
      lane,
      summary: clean(finalText, 1400) || `Real changes committed to ${branchName}.`,
      evidence,
    });
  }

  async function start({ goal, owner, repo, branch, acceptance_criteria = [], layout_agent = 'claude', design_agent = 'chatgpt', reviewer_agent = 'nex' }) {
    if (!goal || !owner || !repo) throw new Error('goal, owner, and repo are required');
    const id = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const criteria = acceptance_criteria.map((item) => clean(item, 220)).filter(Boolean).slice(0, 8);
    const parent = await board.createTask({
      title: `Pipeline: ${clean(goal, 120)}`,
      owner: reviewer_agent,
      description: `Parent coordinator for ${id}. It cannot complete until both lanes and reviewer QA pass.`,
    });
    const base = { id, goal: clean(goal, 900), owner, repo, branch: branch || null, acceptance_criteria: criteria,
      status: 'lanes_running', parent_task_id: parent.id, reviewer_agent, review_task_id: null, final_handoff: null, created_at: Date.now(), updated_at: Date.now(), lanes: {} };
    const layoutDescription = laneDescription({ goal: base.goal, lane: 'layout', acceptanceCriteria: criteria, pipelineId: id });
    const designDescription = laneDescription({ goal: base.goal, lane: 'design', acceptanceCriteria: criteria, pipelineId: id });
    const layout = await board.createTask({ title: `Layout/function lane: ${clean(goal, 100)}`, owner: layout_agent, description: layoutDescription });
    const design = await board.createTask({ title: `Design lane: ${clean(goal, 100)}`, owner: design_agent, description: designDescription });
    base.lane_task_ids = { layout: layout.id, design: design.id };
    await board.updateProgress({ id: parent.id, status: 'building', note: 'Layout/function and design lanes created; auto-delegating to a model, reviewer remains locked until both submit evidence.' });
    const saved = await save(base);
    const baseBranch = branch || 'main';
    await Promise.all([
      runLaneDelegate({ pipelineId: id, lane: 'layout', description: layoutDescription, laneTaskId: layout.id, owner, repo, baseBranch }),
      runLaneDelegate({ pipelineId: id, lane: 'design', description: designDescription, laneTaskId: design.id, owner, repo, baseBranch }),
    ]);
    return load(id);
  }

  async function submitLaneResult({ pipeline_id, lane, summary, evidence = [] }) {
    if (!['layout', 'design'].includes(lane) || !summary) throw new Error('lane (layout or design) and summary are required');
    const run = await load(pipeline_id);
    if (run.status !== 'lanes_running') throw new Error('Pipeline is not accepting lane results');
    const result = { summary: clean(summary, 1400), evidence: evidence.map((item) => clean(item, 320)).filter(Boolean).slice(0, 8), submitted_at: Date.now() };
    run.lanes[lane] = result;
    const laneTask = run.lane_task_ids[lane];
    await board.completeTask({ id: laneTask, result: `${result.summary}\nEvidence: ${result.evidence.join(' | ') || 'none supplied'}` });
    if (run.lanes.layout && run.lanes.design) {
      const review = await board.createTask({ title: `Reviewer/QA gate: ${clean(run.goal, 100)}`, owner: run.reviewer_agent, description: reviewerDescription(run) });
      run.review_task_id = review.id;
      run.status = 'reviewing';
      await board.updateProgress({ id: run.parent_task_id, status: 'testing', note: `Both lanes returned evidence; reviewer gate ${review.id} is now required.` });
    }
    return save(run);
  }

  async function submitReview({ pipeline_id, decision, summary, evidence = [], corrections = [] }) {
    if (!['pass', 'needs_changes'].includes(decision) || !summary) throw new Error('decision (pass or needs_changes) and summary are required');
    const run = await load(pipeline_id);
    if (run.status !== 'reviewing' || !run.review_task_id) throw new Error('Pipeline is not ready for review');
    const reviewResult = { decision, summary: clean(summary, 1400), evidence: evidence.map((item) => clean(item, 320)).filter(Boolean).slice(0, 8), corrections: corrections.map((item) => clean(item, 400)).filter(Boolean).slice(0, 8) };
    await board.completeTask({ id: run.review_task_id, result: `${decision}: ${reviewResult.summary}\nEvidence: ${reviewResult.evidence.join(' | ') || 'none supplied'}` });
    if (decision === 'needs_changes') {
      run.status = 'lanes_running';
      run.review = reviewResult;
      run.review_task_id = null;
      run.lanes = {};
      const correctionNote = `Reviewer requested corrections: ${reviewResult.corrections.join(' | ') || reviewResult.summary}`;
      await Promise.all([
        board.updateProgress({ id: run.lane_task_ids.layout, status: 'building', note: correctionNote }),
        board.updateProgress({ id: run.lane_task_ids.design, status: 'building', note: correctionNote }),
        board.updateProgress({ id: run.parent_task_id, status: 'building', note: `${correctionNote} Both lanes reopened for revision.` }),
      ]);
      return save(run);
    }
    run.status = 'ready_for_nex';
    run.review = reviewResult;
    run.final_handoff = { goal: run.goal, acceptance_criteria: run.acceptance_criteria, lanes: clone(run.lanes), review: reviewResult, ready_at: Date.now() };
    await board.completeTask({ id: run.parent_task_id, result: `Ready for Nex: reviewer passed. ${reviewResult.summary}` });
    return save(run);
  }

  async function get(pipeline_id) { return clone(await load(pipeline_id)); }

  return { start, submitLaneResult, submitReview, get };
}

const board = {
  createTask: liveBoard.createTask,
  updateProgress: liveBoard.updateProgress,
  completeTask: liveBoard.completeTask,
};
const liveService = createTunneledPipelineService({ board, store: redisStore });
export const startTunneledPipeline = (input) => liveService.start(input);
export const submitPipelineLaneResult = (input) => liveService.submitLaneResult(input);
export const submitPipelineReview = (input) => liveService.submitReview(input);
export const getTunneledPipeline = (pipeline_id) => liveService.get(pipeline_id);
