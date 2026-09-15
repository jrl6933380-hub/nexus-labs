// Durable conductor for a bounded multi-agent build.  It deliberately
// coordinates work and evidence; it never grants a worker new credentials.
import * as liveBoard from './board.js';
import { routeToModel } from './modelRouter.js';

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
    'Return a concise summary of what you built, then the actual deliverable as one or more fenced code blocks (```html, ```css, ```js as appropriate). A prose description alone is not an acceptable result. Do not approve or merge work.',
  ].join('\n');
}

// Both lanes currently run on the same underlying model. Since they cannot
// yet be genuinely different specialists, each gets a distinct, ENFORCED
// permission boundary via the system prompt instead — this is what actually
// keeps the two outputs from converging into the same generic page twice.
function laneSystemPrompt(lane) {
  if (lane === 'layout') {
    return [
      'You are the LAYOUT/FUNCTION lane of a two-lane build pipeline.',
      'You are permitted to write: semantic HTML structure, interaction behavior, data flow, and JS/logic.',
      'You are NOT permitted to make final visual decisions: no color palette, no font choices, no finished visual styling. Use only minimal unstyled or structural CSS if needed to prove layout functions — a separate design lane owns final visual polish.',
      'You must return real code in fenced code blocks, not a description of what code would look like.',
    ].join(' ');
  }
  return [
    'You are the DESIGN lane of a two-lane build pipeline.',
    'You are permitted to write: visual hierarchy, color, typography, motion, responsive styling (CSS) applied on top of standard HTML structure for this goal.',
    'You are NOT permitted to invent new page structure, new sections, or new interaction behavior — that belongs to a separate layout lane. Assume a reasonable standard structure for this goal and style it.',
    'You must return real code in fenced code blocks (at minimum CSS, plus HTML only as needed to show the CSS applied), not a description of what the design would look like.',
  ].join(' ');
}

const CODE_FENCE = /```/;

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

  // Fires one lane off to a real model and auto-submits the result through
  // the same path a human/agent would use. Never throws out of start(): a
  // delegation failure (no Gateway key, provider outage, bad response) marks
  // the lane task blocked with the real error and leaves the pipeline in
  // lanes_running so the existing manual submitLaneResult flow still works
  // as a fallback — parking, not crashing.
  async function runLaneDelegate({ pipelineId, lane, description, laneTaskId }) {
    const model = laneModel(env);
    try {
      const { data } = await delegate({
        model,
        body: {
          max_tokens: 8000,
          system: laneSystemPrompt(lane),
          messages: [{ role: 'user', content: description }],
        },
        env,
      });
      const text = extractText(data);
      if (!text) throw new Error('model returned no text content');
      if (!CODE_FENCE.test(text)) {
        throw new Error('model returned prose with no fenced code block — not an acceptable lane artifact');
      }
      await submitLaneResult({
        pipeline_id: pipelineId,
        lane,
        summary: text,
        evidence: [`auto-delegated to ${model}`, 'contains fenced code artifact'],
      });
    } catch (error) {
      await board.updateProgress({
        id: laneTaskId,
        status: 'blocked',
        note: `Auto-delegation to ${model} failed: ${error.message}. Left open for manual pickup.`,
      });
    }
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
    await Promise.all([
      runLaneDelegate({ pipelineId: id, lane: 'layout', description: layoutDescription, laneTaskId: layout.id }),
      runLaneDelegate({ pipelineId: id, lane: 'design', description: designDescription, laneTaskId: design.id }),
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
