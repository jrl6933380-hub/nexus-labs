// /lib/boardGoals.js
// Pure helpers for the Agent Board dashboard: goals with child tasks, an
// automatic checkpoint trail, a claim guard, and owner notes. No I/O here, so
// lib/board.js (storage) and api/board.js (HTTP) stay thin and this file can be
// tested on its own.
//
// How tasks link to a goal without any new agent tooling: put
//   goal: <goal task id>
// on the first line of a task's description. createTask reads it into goal_id.
// A goal is an ordinary board task with kind: 'goal'.

export const CHECKPOINT_LIMIT = 30;
export const NOTE_LIMIT = 20;
const TEXT_LIMIT = 1000;

function clip(value, limit = TEXT_LIMIT) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

export function parseGoalId(description) {
  const match = String(description || '').match(/^\s*goal:\s*([\w-]{3,80})/iu);
  return match ? match[1] : null;
}

// "- [ ] step" / "- [x] step" lines in a description become a step checklist.
export function parseSteps(description) {
  const steps = [];
  for (const line of String(description || '').split('\n')) {
    const match = line.match(/^\s*[-*]\s*\[( |x|X)\]\s+(.+?)\s*$/u);
    if (match && steps.length < 40) steps.push({ text: clip(match[2], 200), done: match[1] !== ' ' });
  }
  return steps;
}

// Newest checkpoint last. Only records changes worth seeing: a status move or a note.
export function appendCheckpoint(task, { status, note, by, at = Date.now() } = {}) {
  const text = clip(note, 500);
  const last = (task.checkpoints || [])[(task.checkpoints || []).length - 1];
  if (!text && last && last.status === status) return task;
  const next = [...(task.checkpoints || []), { at, by: by || task.owner || null, status: status || task.status, note: text || null }];
  task.checkpoints = next.slice(-CHECKPOINT_LIMIT);
  return task;
}

export function addOwnerNote(task, { text, from = 'justin', at = Date.now() } = {}) {
  const clean = clip(text);
  if (!clean) throw new Error('Note text is required');
  task.owner_notes = [...(task.owner_notes || []), { at, from: clip(from, 40) || 'justin', text: clean }].slice(-NOTE_LIMIT);
  return task;
}

export function toggleStep(task, index) {
  const steps = task.steps || [];
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= steps.length) throw new Error('Step not found');
  steps[i] = { ...steps[i], done: !steps[i].done };
  task.steps = steps;
  return task;
}

// Returns an error string when claiming would take a task from another agent.
export function claimConflict(task, owner, force = false) {
  if (force || !task.owner || task.owner === owner || task.status === 'complete') return null;
  return `Task is already claimed by ${task.owner}. Leave it alone, or pass force to take it over.`;
}

export function taskProgress(task, children = []) {
  if (task.kind === 'goal' && children.length) {
    const done = children.filter((child) => child.status === 'complete').length;
    return { done, total: children.length, percent: Math.round((done / children.length) * 100) };
  }
  const steps = task.steps || [];
  if (steps.length) {
    const done = steps.filter((step) => step.done).length;
    return { done, total: steps.length, percent: Math.round((done / steps.length) * 100) };
  }
  const complete = task.status === 'complete';
  return { done: complete ? 1 : 0, total: 1, percent: complete ? 100 : 0 };
}

const ACTIVE = new Set(['planning', 'building', 'testing', 'blocked', 'waiting_for_justin']);

export function buildDashboard(tasks = [], agents = [], now = Date.now()) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map();
  for (const task of tasks) {
    const goalId = task.goal_id || (task.kind === 'goal' ? null : parseGoalId(task.description));
    if (goalId && goalId !== task.id && byId.get(goalId)?.kind === 'goal') {
      children.set(goalId, [...(children.get(goalId) || []), task]);
    }
  }
  const linked = new Set([...children.values()].flat().map((task) => task.id));
  const card = (task, kids = []) => ({ ...task, progress: taskProgress(task, kids), age_ms: now - Number(task.updated_at || task.created_at || now) });

  const goals = tasks.filter((task) => task.kind === 'goal').map((goal) => {
    const kids = children.get(goal.id) || [];
    return { ...card(goal, kids), tasks: kids.map((kid) => card(kid)) };
  });
  const loose = tasks.filter((task) => task.kind !== 'goal' && !linked.has(task.id)).map((task) => card(task));

  const working = {};
  for (const task of tasks) {
    if (task.owner && ACTIVE.has(task.status)) (working[task.owner] ||= []).push({ id: task.id, title: task.title, status: task.status });
  }
  const names = new Set([...agents.map((agent) => agent.id), ...Object.keys(working)]);
  const people = [...names].map((id) => {
    const agent = agents.find((entry) => entry.id === id);
    return { id, name: agent?.display_name || id, status: agent?.status || 'seen on tasks', working_on: working[id] || [] };
  });
  const unclaimed = tasks.filter((task) => !task.owner && task.status !== 'complete' && task.kind !== 'goal').length;
  return { goals, loose, people, counts: { goals: goals.length, tasks: tasks.filter((task) => task.kind !== 'goal').length, unclaimed } };
}
