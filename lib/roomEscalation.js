import { startTunneledPipeline } from './tunneledPipeline.js';
import { redactFields } from './secretScan.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const PREFIX = 'nexus:forge:escalation:';
const TTL_SECONDS = 7 * 24 * 60 * 60;
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;

const compact = (value, limit) => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);

async function redis(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error('Forge escalation storage failed');
  return (await response.json()).result;
}

const liveStore = {
  async save(id, value) {
    await redis(['SET', PREFIX + id, JSON.stringify(value), 'EX', String(TTL_SECONDS)]);
  },
  async get(id) {
    const raw = await redis(['GET', PREFIX + id]);
    return raw ? JSON.parse(raw) : null;
  },
};

export function createRoomEscalator({
  store = liveStore,
  startPipeline = startTunneledPipeline,
  now = () => Date.now(),
} = {}) {
  return {
    async queue({ userId, projectId, request, reason, currentHtml = '' }) {
      if (!userId || !PROJECT_ID_RE.test(String(projectId || ''))) {
        throw new Error('A valid customer and project are required');
      }
      const id = `forge-${now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { fields, secret_check } = redactFields({
        request: compact(request, 4_000),
        reason: compact(reason, 500),
        currentHtml: String(currentHtml || '').slice(0, 180_000),
      });
      const record = {
        id,
        status: 'queueing',
        customerId: String(userId),
        projectId: String(projectId),
        request: fields.request,
        reason: fields.reason,
        currentHtml: fields.currentHtml,
        createdAt: now(),
        pipelineId: null,
      };
      if (secret_check) record.secret_check = secret_check;
      await store.save(id, record);

      const pipeline = await startPipeline({
        goal: `Nexus Forge customer escalation ${id}: complete the requested website or browser app. Request: ${fields.request}`,
        owner: process.env.FORGE_TEAM_REPO_OWNER || 'jrl6933380-hub',
        repo: process.env.FORGE_TEAM_REPO || 'nexus-labs',
        branch: process.env.FORGE_TEAM_BRANCH || 'main',
        acceptance_criteria: [
          `Read the private Forge escalation ${id} before working.`,
          'Deliver a complete working customer result, not a placeholder.',
          'Preserve any existing project unless the request requires a rewrite.',
          'Verify responsive layout and the primary interaction.',
          'Return evidence through the reviewer gate before Nex marks it ready.',
        ],
        layout_agent: 'claude',
        design_agent: 'chatgpt',
        reviewer_agent: 'nex',
      });
      record.pipelineId = pipeline.id;
      record.status = pipeline.status;
      record.updatedAt = now();
      await store.save(id, record);
      return {
        id,
        pipelineId: pipeline.id,
        status: pipeline.status,
        message: `This one needs more than the instant builder, so I opened Build Team ticket ${id}. Structure, design, and Nex review are queued now.`,
      };
    },

    async get(id) {
      if (!/^forge-[a-zA-Z0-9_-]+$/.test(String(id || ''))) throw new Error('Invalid Forge escalation id');
      const record = await store.get(id);
      if (!record) throw new Error('Forge escalation not found');
      return record;
    },
  };
}

export const roomEscalator = createRoomEscalator();
export const getRoomEscalation = (id) => roomEscalator.get(id);
export async function getRoomEscalationPage(id, offset = 0, maxChars = 12_000) {
  const record = await roomEscalator.get(id);
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.max(1_000, Math.min(Number(maxChars) || 12_000, 20_000));
  const source = String(record.currentHtml || '');
  const end = Math.min(source.length, start + size);
  return {
    id: record.id,
    status: record.status,
    projectId: record.projectId,
    request: record.request,
    reason: record.reason,
    pipelineId: record.pipelineId,
    currentHtml: source.slice(start, end),
    sourceOffset: start,
    sourceTotalChars: source.length,
    nextOffset: end < source.length ? end : null,
  };
}
