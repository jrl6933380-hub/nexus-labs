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

// How long to give the real assigned agent (Claude/ChatGPT, whoever owns
// the lane task) to actually claim and submit before the stub fallback
// fires. This is a partial mitigation, not the full fix: a serverless
// request can't sleep indefinitely, so this only covers a short window.
// A real fix would trigger the fallback from a scheduled job instead of
// inline here. Overridable via env without a deploy.
const DEFAULT_LANE_DELEGATE_DELAY_MS = 45_000;
const STUB_EVIDENCE_PREFIX = 'STUB (auto-delegated fallback, no verifiable artifact)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function laneDelegateDelayMs(env) {
  const configured = Number(env.NEX_PIPELINE_DELEGATE_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_LANE_DELEGATE_DELAY_MS;
}

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

function hasStubEvidence(evidence = []) {
  return evidence.some((item) => String(item || '').startsWith(STUB_EVIDENCE_PREFIX));
}

function reviewerDescription(run) {
  const results = Object.entries(run.lanes).map(([lane, value]) =>
    `${lane}: ${value.summary}\nEvidence: ${value.evidence.join(' | ') || 'none supplied'}`).join('\n\n');
  const stubLanes = Object.entries(run.lanes).filter(([, value]) => hasStubEvidence(value.evidence)).map(([lane]) => lane);
  const stubWarning = stubLanes.length
    ? `WARNING: the following lane(s) were produced by the automatic fallback model, not the assigned specialist, and carry no verifiable artifact (no file, branch, or link — text description only): ${stubLanes.join(', ')}. Do not pass on prose plausibility alone. Return needs_changes unless a real inspectable artifact is present.`
    : null;
  return [
    `Pipeline: ${run.id}`,
    `Goal: ${run.goal}`,
    'Review both specialist outputs against the acceptance criteria. Return pass only when they fit together and include adequate evidence; otherwise return needs_changes with a specific correction for one or both lanes.',
    `Acceptance criteria: ${run.acceptance_criteria.join(' | ') || 'Meet the stated goal.'}`,
    stubWarning,
    'Specialist results:', results,
  ].filter(Boolean).join('\n');
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
      const delayMs = laneDelegateDelayMs(env);
      if (delayMs > 0) await sleep(delayMs);

      // If the real assigned agent already claimed or moved this lane task
      // in the delay window, don't race ahead of them with a stub. Skip
      // quietly — the manual submitLaneResult flow is still the live path.
      if (board.getTaskById) {
        const current = await board.getTaskById(laneTaskId).catch(() => null);
        if (current && current.status !== 'planning') return;
      }

      const { data } = await delegate({
        model,
        body: { max_tokens: 4000, messages: [{ role: 'user', content: description }] },
        env,
      });
      const text = extractText(data);
      if (!text) throw new Error('model returned no text content');
      if (data?.stop_reason === 'max_tokens') {
        throw new Error('model response was truncated at the token limit; refusing to submit an incomplete build as evidence');
      }
      await submitLaneResult({
        pipeline_id: pipelineId,
        lane,
        summary: text,
        evidence: [`${STUB_EVIDENCE_PREFIX}: ${model}`],
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
  getTaskById: liveBoard.getTaskById,
};
const liveService = createTunneledPipelineService({ board, store: redisStore });
export const startTunneledPipeline = (input) => liveService.start(input);
export const submitPipelineLaneResult = (input) => liveService.submitLaneResult(input);
export const submitPipelineReview = (input) => liveService.submitReview(input);
export const getTunneledPipeline = (pipeline_id) => liveService.get(pipeline_id);
