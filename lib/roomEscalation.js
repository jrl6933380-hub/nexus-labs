import { startTunneledPipeline } from './tunneledPipeline.js';
import { redactFields } from './secretScan.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const PREFIX = 'nexus:forge:escalation:';
const TTL_SECONDS = 7 * 24 * 60 * 60;
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;

const compact = (value, limit) => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);

// Split into a genuine second lane (layout+design, a real second set of
// hands) only when the request itself signals real separable complexity up
// front. Default is ALWAYS a single build lane now -- every lane is a full
// independent model tool-loop (see runLaneDelegate in tunneledPipeline.js),
// so forking into two lanes on every escalation regardless of size was 2x
// the real spend for jobs that never needed splitting, and meant a shared
// bug got hit twice in parallel instead of once (see the 16 stale_blocked /
// 7 duplicate Board tasks this produced before this change). Deliberately
// conservative: false negatives here just mean the single build lane comes
// back blocked on its own turn/evidence limits and can be re-queued with
// split:true; false positives (splitting something simple) are the
// expensive direction, so the bar to split stays high.
const SPLIT_SIGNAL_RE = /\b(e-?commerce|checkout|payment|booking|reservation|multi-?page|log-?in|sign-?up|authentication|database|admin panel|integration|dashboard)\b/i;
function needsSecondLane(request) {
  const text = String(request || '');
  if (text.length > 2200) return true;
  return SPLIT_SIGNAL_RE.test(text);
}

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
  async list() {
    const keys = await redis(['KEYS', PREFIX + '*']);
    if (!Array.isArray(keys) || !keys.length) return [];
    const raw = await redis(['MGET', ...keys]);
    return (Array.isArray(raw) ? raw : [])
      .map((value) => {
        try {
          return value ? JSON.parse(value) : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  },
};

export function createRoomEscalator({
  store = liveStore,
  // Not defaulted to startTunneledPipeline here on purpose: this factory
  // runs at module-eval time (see `export const roomEscalator =
  // createRoomEscalator()` below), and tunneledPipeline.js now imports back
  // from this module (added in PR #287) to pre-fetch escalation context, so
  // this file and tunneledPipeline.js are a genuine circular import. A
  // default-parameter value is evaluated immediately when the function is
  // called with no argument for that param, which happened here during the
  // circular load before startTunneledPipeline finished initializing —
  // crashing every request through /api/claude-message with "Cannot access
  // 'startTunneledPipeline' before initialization". Leaving it undefined
  // here and falling back to the live import inside queue() below (a method
  // that only runs later, at real request time, after both modules have
  // fully loaded) avoids the cycle entirely.
  startPipeline,
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

      const pipeline = await (startPipeline || startTunneledPipeline)({
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

    // Read-only rollup across every open (and recently closed) escalation.
    // Backed by the same store as get()/queue() — no separate index to
    // drift out of sync, at the cost of one KEYS scan per call, which is
    // fine at this record count (7-day TTL keeps the keyspace bounded).
    async list({ status } = {}) {
      const records = await store.list();
      const filtered = status ? records.filter((record) => record.status === status) : records;
      return filtered
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((record) => ({
          id: record.id,
          status: record.status,
          customerId: record.customerId,
          projectId: record.projectId,
          request: record.request,
          pipelineId: record.pipelineId,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt || null,
        }));
    },
  };
}

export const roomEscalator = createRoomEscalator();
export const getRoomEscalation = (id) => roomEscalator.get(id);
export const listForgeEscalations = (opts) => roomEscalator.list(opts);
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
