// Nex Chat's built-in planner. It is intentionally its own store rather than
// borrowing Nexus Life's future data model: both products can stand alone,
// while source/source_id leave a clean seam for an opt-in unified calendar.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const PLANNER_KEY = 'nexus:planner:items:v1';
const VALID_SOURCES = new Set(['nex_chat', 'life', 'teams', 'legacy']);
const VALID_STATUSES = new Set(['planned', 'done', 'cancelled']);

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Redis command ${command[0]} failed`);
  return data.result;
}

function requiredText(value, label, limit) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text.slice(0, limit);
}

function optionalText(value, limit) {
  return value == null ? '' : String(value).trim().slice(0, limit);
}

function isoDate(value, label, { optional = false } = {}) {
  if ((value == null || value === '') && optional) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} must be a valid date and time`);
  return new Date(time).toISOString();
}

function parseHash(raw) {
  if (!Array.isArray(raw)) return [];
  const items = [];
  for (let index = 0; index < raw.length; index += 2) {
    try { items.push(JSON.parse(raw[index + 1])); } catch { /* skip malformed records */ }
  }
  return items;
}

export function createPlannerStore({ command = redisCommand, now = () => Date.now(), idFactory } = {}) {
  const newId = idFactory || (() => `${now()}-${Math.random().toString(36).slice(2, 8)}`);

  async function get(id) {
    if (!id) throw new Error('Planner item id is required');
    const raw = await command(['HGET', PLANNER_KEY, id]);
    if (!raw) throw new Error(`Planner item not found: ${id}`);
    return JSON.parse(raw);
  }

  async function save(item) {
    await command(['HSET', PLANNER_KEY, item.id, JSON.stringify(item)]);
    return item;
  }

  async function listPlannerItems({ from, to, status } = {}) {
    const fromTime = from ? Date.parse(from) : null;
    const toTime = to ? Date.parse(to) : null;
    if (from && !Number.isFinite(fromTime)) throw new Error('from must be a valid date');
    if (to && !Number.isFinite(toTime)) throw new Error('to must be a valid date');
    if (status && !VALID_STATUSES.has(status)) throw new Error('Invalid planner status');
    return parseHash(await command(['HGETALL', PLANNER_KEY]))
      .filter((item) => !status || item.status === status)
      .filter((item) => fromTime == null || Date.parse(item.starts_at) >= fromTime)
      .filter((item) => toTime == null || Date.parse(item.starts_at) < toTime)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  }

  async function createPlannerItem(input = {}) {
    const startsAt = isoDate(input.starts_at, 'starts_at');
    const endsAt = isoDate(input.ends_at, 'ends_at', { optional: true });
    if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new Error('ends_at cannot be before starts_at');
    const source = input.source || 'nex_chat';
    const status = input.status || 'planned';
    if (!VALID_SOURCES.has(source)) throw new Error('Invalid planner source');
    if (!VALID_STATUSES.has(status)) throw new Error('Invalid planner status');
    const timestamp = now();
    return save({
      id: newId(),
      title: requiredText(input.title, 'title', 160),
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: Boolean(input.all_day),
      notes: optionalText(input.notes, 4000),
      source,
      source_id: optionalText(input.source_id, 200) || null,
      status,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  async function updatePlannerItem(input = {}) {
    const current = await get(input.id);
    const startsAt = input.starts_at === undefined ? current.starts_at : isoDate(input.starts_at, 'starts_at');
    const endsAt = input.ends_at === undefined ? current.ends_at : isoDate(input.ends_at, 'ends_at', { optional: true });
    if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new Error('ends_at cannot be before starts_at');
    const source = input.source === undefined ? current.source : input.source;
    const status = input.status === undefined ? current.status : input.status;
    if (!VALID_SOURCES.has(source)) throw new Error('Invalid planner source');
    if (!VALID_STATUSES.has(status)) throw new Error('Invalid planner status');
    return save({
      ...current,
      title: input.title === undefined ? current.title : requiredText(input.title, 'title', 160),
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: input.all_day === undefined ? current.all_day : Boolean(input.all_day),
      notes: input.notes === undefined ? current.notes : optionalText(input.notes, 4000),
      source,
      source_id: input.source_id === undefined ? current.source_id : (optionalText(input.source_id, 200) || null),
      status,
      updated_at: now(),
    });
  }

  async function deletePlannerItem(id) {
    const item = await get(id);
    const removed = Number(await command(['HDEL', PLANNER_KEY, id]));
    if (removed !== 1) throw new Error(`Planner item deletion did not persist: ${id}`);
    return item;
  }

  return { listPlannerItems, createPlannerItem, updatePlannerItem, deletePlannerItem };
}

const liveStore = createPlannerStore();
export const listPlannerItems = liveStore.listPlannerItems;
export const createPlannerItem = liveStore.createPlannerItem;
export const updatePlannerItem = liveStore.updatePlannerItem;
export const deletePlannerItem = liveStore.deletePlannerItem;
