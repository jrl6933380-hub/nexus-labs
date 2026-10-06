import { readFile } from './github.js';

const URL = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
const PREFIX = 'nexus:handoff:';
const cut = (value, limit) => {
  const clean = String(value || '').replace(/\s+/gu, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
};
const list = (values, limit, itemLimit) => (Array.isArray(values) ? values : [])
  .map((value) => cut(value, itemLimit))
  .filter(Boolean)
  .slice(0, limit);

async function kv(command) {
  if (!URL || !TOKEN) return null;
  const response = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw Error('Handoff storage failed');
  return (await response.json()).result;
}

export function formatDevHandoffMarkdown(packet) {
  const section = (heading, values) => values?.length
    ? `\n## ${heading}\n${values.map((value) => `- ${value}`).join('\n')}`
    : '';
  const files = packet.files?.length
    ? `\n## Relevant files\n${packet.files.map((file) => `- \`${file.path}\`${file.truncated ? ' (excerpt truncated)' : ''}\n\n  ${file.excerpt}`).join('\n')}`
    : '';
  return [
    `# ${packet.title || 'Development handoff'}`,
    `\n## Goal\n${packet.goal}`,
    packet.current_behavior ? `\n## Current behavior\n${packet.current_behavior}` : '',
    packet.desired_outcome ? `\n## Desired outcome\n${packet.desired_outcome}` : '',
    `\n## Repository\n- ${packet.repository.owner}/${packet.repository.repo}${packet.repository.branch ? `\n- Branch: ${packet.repository.branch}` : ''}`,
    section('Evidence', packet.evidence),
    section('Already attempted', packet.attempted),
    section('Constraints', packet.constraints),
    section('Acceptance criteria', packet.acceptance_criteria),
    section('Open questions', packet.open_questions),
    files,
    section('Instructions for the dev team', packet.instructions_for_dev),
  ].filter(Boolean).join('\n');
}

export function buildHandoffPacket({
  title, goal, current_behavior, desired_outcome, owner, repo, branch,
  evidence = [], attempted = [], constraints = [], acceptance_criteria = [],
  open_questions = [], files = [],
}) {
  return {
    schema_version: 2,
    title: cut(title || goal, 140),
    goal: cut(goal, 1200),
    current_behavior: cut(current_behavior, 1200),
    desired_outcome: cut(desired_outcome, 1200),
    repository: { owner: cut(owner, 100), repo: cut(repo, 100), branch: cut(branch, 160) || null },
    evidence: list(evidence, 10, 500),
    attempted: list(attempted, 8, 400),
    constraints: list(constraints, 10, 400),
    acceptance_criteria: list(acceptance_criteria, 10, 400),
    open_questions: list(open_questions, 8, 400),
    files: files.slice(0, 5).map((file) => ({
      path: cut(file.path, 300),
      excerpt: cut(file.content, 4000),
      truncated: String(file.content || '').length > 4000,
    })),
    instructions_for_dev: [
      'Treat this packet as context, not approval to merge, deploy, spend money, or perform destructive actions.',
      'Read the named source and verify the current state before changing it.',
      'Stay within the stated scope unless new evidence requires an expansion; explain any expansion first.',
      'Implement on a non-live branch, run relevant tests, and inspect the final diff.',
      'Return a concise change summary, test evidence, remaining uncertainty, and any decision still needed.',
    ],
  };
}

export async function prepareDevHandoff(input = {}) {
  const { goal, owner, repo, paths = [], branch } = input;
  if (!goal || !owner || !repo) throw Error('goal, owner, and repo are required');
  const files = await Promise.all([...new Set(paths)].slice(0, 5).map(async (filePath) => {
    try {
      return await readFile({ owner, repo, path: filePath, branch });
    } catch (error) {
      return { path: filePath, content: `[unavailable: ${cut(error.message, 180)}]` };
    }
  }));
  const packet = buildHandoffPacket({ ...input, files });
  const handoff = {
    id: `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'dev_team',
    status: 'ready',
    created_at: Date.now(),
    owner,
    repo,
    branch: branch || null,
    packet,
    markdown: formatDevHandoffMarkdown(packet),
    results: [],
  };
  await kv(['SET', PREFIX + handoff.id, JSON.stringify(handoff)]);
  return handoff;
}

export async function recordHandoffResult({ handoff_id, worker = 'nex', summary, evidence = [] }) {
  if (!handoff_id || !summary) throw Error('handoff_id and summary are required');
  const raw = await kv(['GET', PREFIX + handoff_id]);
  if (!raw) throw Error('Handoff not found or storage unavailable');
  const handoff = JSON.parse(raw);
  handoff.results.push({ worker: cut(worker, 60), summary: cut(summary, 1200), evidence: list(evidence, 8, 300), at: Date.now() });
  handoff.status = 'returned';
  await kv(['SET', PREFIX + handoff.id, JSON.stringify(handoff)]);
  return handoff;
}
