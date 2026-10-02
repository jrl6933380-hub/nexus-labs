// Durable project direction for Nex and a calm customer-facing projection.
// This stores operational state (facts, tasks, dependencies and evidence),
// never hidden chain-of-thought or credentials.

import { readProjectContext } from './projectContext.js';
import { redactSecrets } from '../secretScan.js';

const ROADMAP_VERSION = 1;
const ROADMAP_KEY_PREFIX = 'nexus:forge:roadmap:';
const VALID_STATES = new Set(['decided', 'next', 'connection']);

function normalizeOwner(value) {
  const owner = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,120}$/.test(owner)) throw new Error('A valid ownerUsername is required.');
  return owner;
}

function normalizeProjectId(value) {
  const projectId = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(projectId)) throw new Error('Invalid projectId.');
  return projectId;
}

function cleanText(value, max = 160) {
  return redactSecrets(String(value || '').trim().slice(0, max)).text;
}

async function redisCommand(command) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Project Roadmap storage failed');
  return data.result;
}

export function createRedisRoadmapStore() {
  return {
    async get(key, field) {
      const raw = await redisCommand(['HGET', key, field]);
      return raw ? JSON.parse(raw) : null;
    },
    async set(key, field, value) {
      await redisCommand(['HSET', key, field, JSON.stringify(value)]);
    },
  };
}

export function createMemoryRoadmapStore() {
  const records = new Map();
  return {
    async get(key, field) { return structuredClone(records.get(`${key}:${field}`) || null); },
    async set(key, field, value) { records.set(`${key}:${field}`, structuredClone(value)); },
  };
}

function storageKey(ownerUsername) {
  return ROADMAP_KEY_PREFIX + normalizeOwner(ownerUsername);
}

function planFacts(plan) {
  return (plan?.summary || []).slice(0, 12).map(item => ({
    label: cleanText(item.label, 100),
    value: cleanText(item.value, 240),
    source: plan.mode === 'addon' ? 'addition_plan' : 'project_plan',
  })).filter(item => item.label && item.value);
}

function assistantItems(value) {
  return Array.isArray(value) ? value.map(item => {
    const label = cleanText(item?.label, 120);
    const state = VALID_STATES.has(item?.state) ? item.state : 'next';
    return label ? { label, state } : null;
  }).filter(Boolean).slice(0, 12) : [];
}

function pathItem(id, label, status, note) {
  return { id, label, status, note };
}

export function reconcileProjectRoadmap(existing = {}, context = {}, now = () => Date.now()) {
  const project = context.project || null;
  const original = context.originalPlan || null;
  const addition = context.addonPlan || null;
  const connections = Array.isArray(context.connections) ? context.connections : [];
  const requiredConnections = connections.filter(item => item.required);
  const waitingConnections = requiredConnections.filter(item => item.status !== 'ready');
  const originalReady = Boolean(original?.progress?.ready);
  const additionReady = Boolean(addition?.progress?.ready);
  const additionApproved = Boolean(addition?.approved_at);
  const hasProject = Boolean(project);
  const pieces = project?.pieces || [];
  const additionIdea = cleanText(addition?.answers?.idea || '', 90);
  const additionBuilt = Boolean(additionIdea && pieces.some(piece => cleanText(piece.label, 100).toLowerCase().includes(additionIdea.toLowerCase().slice(0, 40))));

  const path = [
    pathItem('plan', 'Shape the project', originalReady || hasProject ? 'complete' : 'current',
      originalReady ? 'The first-build decisions are saved.' : hasProject ? 'The working version establishes the starting direction.' : original?.next_question?.question || 'Answer the next focused planning question.'),
    pathItem('build', 'Build the working version', hasProject ? 'complete' : originalReady ? 'current' : 'waiting',
      hasProject ? `${project.label} has a saved working version.` : originalReady ? 'The plan is ready to approve and build.' : 'This unlocks after the initial direction is clear.'),
  ];

  if (addition && (addition.addition_kind || Object.keys(addition.answers || {}).length)) {
    const additionLabel = additionIdea || 'Plan the next addition';
    path.push(pathItem('addition', additionLabel,
      additionBuilt ? 'complete' : 'current',
      additionBuilt ? 'This addition is saved in the project stack.'
        : additionApproved ? 'Approved and ready to build into the existing project.'
        : additionReady ? 'Ready for review and approval.' : addition.next_question?.question || 'Continue the focused addition plan.'));
  } else if (pieces.length) {
    path.push(pathItem('addition', 'Grow the project', 'complete', `${pieces.length} supporting piece${pieces.length === 1 ? '' : 's'} added to the same stack.`));
  }

  path.push(pathItem('connections', 'Prepare required connections',
    !hasProject ? 'waiting' : waitingConnections.length ? 'current' : 'complete',
    !hasProject ? 'Connections are scoped after the first working version.'
      : waitingConnections.length ? `${waitingConnections.length} required connection${waitingConnections.length === 1 ? '' : 's'} still need setup or a check.`
        : requiredConnections.length ? 'Every required connection is tested and ready.' : 'No required services are currently identified.'));
  path.push(pathItem('review', 'Review the complete experience',
    hasProject && !waitingConnections.length ? 'current' : 'waiting',
    hasProject && !waitingConnections.length ? 'Check the full flow, content, mobile layout, and expected results.' : 'Review follows the working build and its required connections.'));
  path.push(pathItem('launch', 'Go live and keep improving', 'waiting', 'Publish only after the complete experience has been reviewed.'));

  let bestNextStep;
  if (!hasProject && !originalReady) bestNextStep = { label: original?.next_question?.question || 'Continue the project plan', view: 'brief' };
  else if (!hasProject) bestNextStep = { label: 'Approve and build the first version', view: 'brief' };
  else if (addition && !additionReady) bestNextStep = { label: addition.next_question?.question || 'Continue the addition plan', view: 'brief' };
  else if (additionReady && !additionApproved) bestNextStep = { label: 'Review and approve the addition', view: 'brief' };
  else if (additionApproved && !additionBuilt) bestNextStep = { label: 'Build the approved addition', view: 'brief' };
  else if (waitingConnections.length) bestNextStep = { label: `Prepare ${waitingConnections[0].label}`, view: 'stack' };
  else {
    const nextAssistantItem = assistantItems(existing.assistant_items).find(item => item.state === 'next');
    bestNextStep = nextAssistantItem
      ? { label: nextAssistantItem.label, view: 'chat' }
      : { label: 'Review the complete project', view: 'preview' };
  }

  const facts = [...planFacts(original), ...planFacts(addition)];
  if (project) facts.push({ label: 'Saved project', value: project.label, source: 'build_history' });
  for (const piece of pieces.slice(0, 12)) facts.push({ label: `Supporting ${piece.kind || 'piece'}`, value: cleanText(piece.label, 100), source: 'build_history' });

  return {
    version: ROADMAP_VERSION,
    project_id: project?.projectId || existing.project_id || null,
    project_label: cleanText(project?.label || existing.project_label || original?.answers?.idea || 'New project', 80),
    phase: !hasProject ? (originalReady ? 'ready_to_build' : 'planning')
      : waitingConnections.length ? 'connecting' : addition && !additionApproved ? 'planning_addition' : 'reviewing',
    objective: cleanText(addition?.answers?.idea || original?.answers?.idea || existing.objective || project?.label || '', 300),
    confirmed_facts: facts.slice(0, 20),
    open_questions: [original?.next_question?.question, addition?.next_question?.question].filter(Boolean).map(value => cleanText(value, 180)),
    dependencies: connections.map(item => ({ id: item.id, label: cleanText(item.label, 80), status: item.status, required: Boolean(item.required) })),
    assistant_items: assistantItems(existing.assistant_items),
    path,
    best_next_step: bestNextStep,
    updated_at: now(),
  };
}

export function publicProjectRoadmap(roadmap) {
  const path = Array.isArray(roadmap?.path) ? roadmap.path : [];
  return {
    version: roadmap?.version || ROADMAP_VERSION,
    project_id: roadmap?.project_id || null,
    project_label: roadmap?.project_label || 'Your project',
    phase: roadmap?.phase || 'planning',
    progress: { complete: path.filter(item => item.status === 'complete').length, total: path.length },
    best_next_step: roadmap?.best_next_step || null,
    path: path.map(item => ({ id: item.id, label: item.label, status: item.status, note: item.note })),
    updated_at: roadmap?.updated_at || null,
  };
}

export async function getProjectRoadmap({ ownerUsername, projectId, context = null, store = createRedisRoadmapStore(), readContext = readProjectContext, now = () => Date.now() } = {}) {
  const owner = normalizeOwner(ownerUsername);
  const id = normalizeProjectId(projectId);
  const existing = await store.get(storageKey(owner), id) || { project_id: id };
  const resolvedContext = context || await readContext({ ownerUsername: owner, projectId: id });
  const roadmap = reconcileProjectRoadmap(existing, resolvedContext, now);
  roadmap.project_id = id;
  await store.set(storageKey(owner), id, roadmap);
  return roadmap;
}

export async function recordRoadmapChecklist({ ownerUsername, projectId, checklist, context = null, store = createRedisRoadmapStore(), readContext = readProjectContext, now = () => Date.now() } = {}) {
  const owner = normalizeOwner(ownerUsername);
  const id = normalizeProjectId(projectId);
  const existing = await store.get(storageKey(owner), id) || { project_id: id };
  const incoming = assistantItems(checklist?.items).slice(0, 7);
  const incomingLabels = new Set(incoming.map(item => item.label.toLowerCase()));
  const retainedDecisions = assistantItems(existing.assistant_items)
    .filter(item => item.state !== 'next' && !incomingLabels.has(item.label.toLowerCase()));
  existing.assistant_items = [...incoming, ...retainedDecisions].slice(0, 12);
  const resolvedContext = context || await readContext({ ownerUsername: owner, projectId: id });
  const roadmap = reconcileProjectRoadmap(existing, resolvedContext, now);
  roadmap.project_id = id;
  await store.set(storageKey(owner), id, roadmap);
  return roadmap;
}

export const __roadmapInternals = { normalizeOwner, normalizeProjectId, assistantItems };
