// Shared Schedule engine for Nex Chat and Nexus Life. Every record is scoped
// to the authenticated account. The older owner-only planner key is migrated
// lazily into the owner's scoped schedule so existing plans are not lost.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const LEGACY_PLANNER_KEY = 'nexus:planner:items:v1';
const SCHEDULE_PREFIX = 'nexus:schedule:items:v2:';
const MIGRATION_PREFIX = 'nexus:schedule:migrated:v1:';

export const SCHEDULE_CATEGORIES = ['work', 'project', 'gym', 'health', 'family', 'social', 'appointment', 'errands', 'learning', 'creative', 'rest', 'travel', 'other'];
export const SCHEDULE_KINDS = ['event', 'task', 'reminder', 'time_block'];
export const SCHEDULE_FLEXIBILITY = ['fixed', 'flexible'];
export const SCHEDULE_PRIORITIES = ['low', 'normal', 'high'];
export const SCHEDULE_REPEAT = ['none', 'every_week', 'ask_weekly'];

const VALID_SOURCES = new Set(['nex_chat', 'life', 'teams', 'legacy', 'workbench']);
const VALID_STATUSES = new Set(['planned', 'draft', 'done', 'cancelled']);
const VALID_CATEGORIES = new Set(SCHEDULE_CATEGORIES);
const VALID_KINDS = new Set(SCHEDULE_KINDS);
const VALID_FLEXIBILITY = new Set(SCHEDULE_FLEXIBILITY);
const VALID_PRIORITIES = new Set(SCHEDULE_PRIORITIES);
const VALID_REPEAT = new Set(SCHEDULE_REPEAT);
const MAX_BULK_ITEMS = 80;

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Schedule command ${command[0]} failed`);
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

function scopedKey(userId) {
  const scope = requiredText(userId, 'Schedule account', 240);
  return `${SCHEDULE_PREFIX}${encodeURIComponent(scope)}`;
}

function migrationKey(userId) {
  return `${MIGRATION_PREFIX}${encodeURIComponent(requiredText(userId, 'Schedule account', 240))}`;
}

function isoDate(value, label, { optional = false } = {}) {
  if ((value == null || value === '') && optional) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} must be a valid date and time`);
  return new Date(time).toISOString();
}

function enumValue(value, allowed, fallback, label) {
  const normalized = value == null || value === '' ? fallback : String(value);
  if (!allowed.has(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

function boundedInteger(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Invalid ${label}`);
  return number;
}

function parseHash(raw) {
  if (!Array.isArray(raw)) return [];
  const items = [];
  for (let index = 0; index < raw.length; index += 2) {
    try { items.push(JSON.parse(raw[index + 1])); } catch { /* skip malformed records */ }
  }
  return items;
}

function itemEnd(item) {
  const start = Date.parse(item.starts_at);
  if (item.ends_at) return Date.parse(item.ends_at);
  return start + (item.all_day ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
}

function dateRange(startValue, endValue, label = 'range') {
  const start = Date.parse(startValue);
  const end = Date.parse(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`${label} must have valid increasing dates`);
  return { start, end };
}

function overlaps(left, right) {
  return Date.parse(left.starts_at) < itemEnd(right) && Date.parse(right.starts_at) < itemEnd(left);
}

function publicSummary(items) {
  const active = items.filter((item) => item.status === 'planned' || item.status === 'draft');
  const categoryMinutes = {};
  let scheduledMinutes = 0;
  for (const item of active) {
    const minutes = Math.max(15, Math.round((itemEnd(item) - Date.parse(item.starts_at)) / 60000));
    scheduledMinutes += minutes;
    categoryMinutes[item.category || 'other'] = (categoryMinutes[item.category || 'other'] || 0) + minutes;
  }
  const conflicts = [];
  const ordered = [...active].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      if (Date.parse(ordered[right].starts_at) >= itemEnd(ordered[left])) break;
      if (overlaps(ordered[left], ordered[right])) conflicts.push({ item_ids: [ordered[left].id, ordered[right].id] });
    }
  }
  return { scheduled_minutes: scheduledMinutes, category_minutes: categoryMinutes, conflicts };
}

export function createPlannerStore({ command = redisCommand, now = () => Date.now(), idFactory } = {}) {
  const newId = idFactory || (() => `${now()}-${Math.random().toString(36).slice(2, 8)}`);

  async function migrateLegacy(userId, allowLegacyMigration) {
    if (!allowLegacyMigration) return;
    const marker = migrationKey(userId);
    if (await command(['GET', marker])) return;
    const key = scopedKey(userId);
    const existing = parseHash(await command(['HGETALL', key]));
    if (!existing.length) {
      const legacy = parseHash(await command(['HGETALL', LEGACY_PLANNER_KEY]));
      for (const oldItem of legacy) {
        const normalized = normalizeItem({ ...oldItem, id: oldItem.id || newId() }, oldItem.created_at || now());
        await command(['HSET', key, normalized.id, JSON.stringify(normalized)]);
      }
    }
    await command(['SET', marker, '1']);
  }

  function normalizeItem(input, timestamp, current = null) {
    const startsAt = input.starts_at === undefined && current ? current.starts_at : isoDate(input.starts_at, 'starts_at');
    const endsAt = input.ends_at === undefined && current ? current.ends_at : isoDate(input.ends_at, 'ends_at', { optional: true });
    if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new Error('ends_at cannot be before starts_at');
    const reminder = input.reminder_minutes === undefined && current ? current.reminder_minutes : boundedInteger(input.reminder_minutes, null, 0, 10080, 'reminder');
    return {
      ...(current || {}),
      id: input.id || current?.id || newId(),
      title: input.title === undefined && current ? current.title : requiredText(input.title, 'title', 160),
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: input.all_day === undefined && current ? current.all_day : Boolean(input.all_day),
      notes: input.notes === undefined && current ? current.notes : optionalText(input.notes, 4000),
      category: enumValue(input.category === undefined && current ? current.category : input.category, VALID_CATEGORIES, 'other', 'schedule category'),
      kind: enumValue(input.kind === undefined && current ? current.kind : input.kind, VALID_KINDS, 'event', 'schedule kind'),
      flexibility: enumValue(input.flexibility === undefined && current ? current.flexibility : input.flexibility, VALID_FLEXIBILITY, 'fixed', 'schedule flexibility'),
      priority: enumValue(input.priority === undefined && current ? current.priority : input.priority, VALID_PRIORITIES, 'normal', 'schedule priority'),
      repeat_mode: enumValue(input.repeat_mode === undefined && current ? current.repeat_mode : input.repeat_mode, VALID_REPEAT, 'none', 'schedule repeat mode'),
      protected: input.protected === undefined && current ? Boolean(current.protected) : Boolean(input.protected),
      reminder_minutes: reminder,
      source: enumValue(input.source === undefined && current ? current.source : input.source, VALID_SOURCES, 'nex_chat', 'schedule source'),
      source_id: input.source_id === undefined && current ? current.source_id : (optionalText(input.source_id, 200) || null),
      project_id: input.project_id === undefined && current ? current.project_id : (optionalText(input.project_id, 200) || null),
      status: enumValue(input.status === undefined && current ? current.status : input.status, VALID_STATUSES, 'planned', 'schedule status'),
      draft_id: input.draft_id === undefined && current ? current.draft_id : (optionalText(input.draft_id, 120) || null),
      rolled_from_id: input.rolled_from_id === undefined && current ? current.rolled_from_id : (optionalText(input.rolled_from_id, 200) || null),
      period_label: input.period_label === undefined && current ? current.period_label : (optionalText(input.period_label, 80) || null),
      created_at: current?.created_at || Number(input.created_at) || timestamp,
      updated_at: timestamp,
    };
  }

  async function get(userId, id) {
    if (!id) throw new Error('Schedule item id is required');
    const raw = await command(['HGET', scopedKey(userId), id]);
    if (!raw) throw new Error(`Schedule item not found: ${id}`);
    return JSON.parse(raw);
  }

  async function save(userId, item) {
    await command(['HSET', scopedKey(userId), item.id, JSON.stringify(item)]);
    return item;
  }

  async function listPlannerItems(query = {}, userId = 'owner', options = {}) {
    await migrateLegacy(userId, options.allowLegacyMigration);
    const fromTime = query.from ? Date.parse(query.from) : null;
    const toTime = query.to ? Date.parse(query.to) : null;
    if (query.from && !Number.isFinite(fromTime)) throw new Error('from must be a valid date');
    if (query.to && !Number.isFinite(toTime)) throw new Error('to must be a valid date');
    if (query.status && !VALID_STATUSES.has(query.status)) throw new Error('Invalid schedule status');
    return parseHash(await command(['HGETALL', scopedKey(userId)]))
      .filter((item) => !query.status || item.status === query.status)
      .filter((item) => fromTime == null || Date.parse(item.starts_at) >= fromTime)
      .filter((item) => toTime == null || Date.parse(item.starts_at) < toTime)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  }

  async function createPlannerItem(input = {}, userId = 'owner') {
    return save(userId, normalizeItem(input, now()));
  }

  async function previewPlannerItem(input = {}, userId = 'owner') {
    const item = normalizeItem(input, now());
    const conflicts = (await listPlannerItems({}, userId))
      .filter((candidate) => (candidate.status === 'planned' || candidate.status === 'draft') && overlaps(item, candidate));
    return { item, conflicts };
  }

  async function updatePlannerItem(input = {}, userId = 'owner') {
    const current = await get(userId, input.id);
    return save(userId, normalizeItem(input, now(), current));
  }

  async function deletePlannerItem(id, userId = 'owner') {
    const item = await get(userId, id);
    const removed = Number(await command(['HDEL', scopedKey(userId), id]));
    if (removed !== 1) throw new Error(`Schedule item deletion did not persist: ${id}`);
    return item;
  }

  async function getScheduleOverview(query = {}, userId = 'owner', options = {}) {
    const items = await listPlannerItems(query, userId, options);
    const draftItems = (await listPlannerItems({status:'draft'}, userId)).filter((item) => item.draft_id);
    return {
      items,
      summary: publicSummary(items),
      normal_week: items.filter((item) => item.repeat_mode === 'every_week' && item.status !== 'cancelled'),
      drafts: [...new Set(draftItems.map((item) => item.draft_id))],
      draft_items: draftItems,
    };
  }

  async function createWeekDraft(input = {}, userId = 'owner') {
    const source = dateRange(input.source_start, input.source_end, 'source week');
    const target = dateRange(input.target_start, input.target_end, 'target week');
    const offset = target.start - source.start;
    const sourceItems = await listPlannerItems({ from: new Date(source.start).toISOString(), to: new Date(source.end).toISOString() }, userId);
    const includeIds = new Set(Array.isArray(input.include_ids) ? input.include_ids.map(String).slice(0, MAX_BULK_ITEMS) : []);
    const mode = input.mode === 'normal' ? 'normal' : 'all';
    const selected = sourceItems.filter((item) => {
      if (item.status === 'cancelled' || item.status === 'draft') return false;
      if (includeIds.size) return includeIds.has(item.id);
      return mode === 'all' || item.repeat_mode === 'every_week';
    }).slice(0, MAX_BULK_ITEMS);
    const draftId = `week-${newId()}`;
    const existing = await listPlannerItems({ from: new Date(target.start).toISOString(), to: new Date(target.end).toISOString() }, userId);
    const selectedIds = new Set(selected.map((item) => item.id));
    const reusable = existing.filter((item) => item.status === 'draft' && item.draft_id && selectedIds.has(item.rolled_from_id));
    if (reusable.length) return { draft_id: reusable[0].draft_id, items: reusable, summary: publicSummary(reusable) };
    const created = [];
    for (const item of selected) {
      const nextStart = new Date(Date.parse(item.starts_at) + offset).toISOString();
      if (existing.some((candidate) => candidate.rolled_from_id === item.id && candidate.starts_at === nextStart)) continue;
      const nextEnd = item.ends_at ? new Date(Date.parse(item.ends_at) + offset).toISOString() : null;
      created.push(await createPlannerItem({
        ...item,
        id: undefined,
        starts_at: nextStart,
        ends_at: nextEnd,
        status: 'draft',
        draft_id: draftId,
        rolled_from_id: item.id,
        created_at: undefined,
      }, userId));
    }
    return { draft_id: draftId, items: created, summary: publicSummary(created) };
  }

  async function applyWeekDraft(draftId, userId = 'owner') {
    const id = requiredText(draftId, 'draft_id', 120);
    const items = (await listPlannerItems({}, userId)).filter((item) => item.draft_id === id && item.status === 'draft');
    if (!items.length) throw new Error('Schedule draft not found');
    const applied = [];
    for (const item of items) applied.push(await updatePlannerItem({ id: item.id, status: 'planned', draft_id: null }, userId));
    return { items: applied, summary: publicSummary(applied) };
  }

  async function generateScheduleDraft(input = {}, userId = 'owner') {
    if (!Array.isArray(input.windows) || !input.windows.length || input.windows.length > 14) throw new Error('Choose 1–14 available days');
    if (!Array.isArray(input.requests) || !input.requests.length || input.requests.length > MAX_BULK_ITEMS) throw new Error('Choose at least one priority');
    const windows = input.windows.map((window) => dateRange(window.starts_at, window.ends_at, 'available hours')).sort((a, b) => a.start - b.start);
    for (let index = 0; index < windows.length; index += 1) {
      if (windows[index].end - windows[index].start > 90000000 || (index && windows[index].start < windows[index - 1].end)) throw new Error('Available days must not overlap');
    }
    function validateActivityWindows(activityWindows) {
      if (!Array.isArray(activityWindows) || !activityWindows.length || activityWindows.length > 14) throw new Error('Choose 1–14 days for each activity');
      const ranges = activityWindows.map((window) => dateRange(window.starts_at, window.ends_at, 'activity times')).sort((a,b) => a.start-b.start);
      for (let index = 0; index < ranges.length; index += 1) {
        const range = ranges[index];
        if (!windows.some((window) => range.start >= window.start && range.end <= window.end) || (index && range.start < ranges[index-1].end)) throw new Error('Activity times must fit within the chosen days and not overlap');
      }
      return ranges;
    }
    const requests = input.requests.map((request) => ({
      title: requiredText(request.title, 'priority name', 160),
      category: enumValue(request.category, VALID_CATEGORIES, 'other', 'schedule category'),
      count: boundedInteger(request.count, 1, 1, 14, 'session count'),
      minutes: boundedInteger(request.minutes, 60, 15, 960, 'session duration'),
      flexibility: enumValue(request.flexibility, new Set(['fixed','flexible']), 'flexible', 'placement'),
      windows: request.windows === undefined ? windows : validateActivityWindows(request.windows),
    }));
    if (requests.reduce((sum, request) => sum + request.count, 0) > MAX_BULK_ITEMS) throw new Error('Choose at most 80 sessions');
    const existing = (await listPlannerItems({}, userId)).filter((item) => item.status === 'planned' || item.status === 'draft');
    const occupied = existing.map((item) => ({ start: Date.parse(item.starts_at), end: itemEnd(item) }));
    const dailyLoads = new Map();
    const draftId = `auto-${newId()}`;
    const items = [];
    const unplaced = [];
    for (const request of requests) {
      const usedDays = new Set();
      const dayKey = (window) => windows.findIndex((day) => window.start >= day.start && window.end <= day.end);
      for (let session = 0; session < request.count; session += 1) {
        const candidates = request.windows.map((window, index) => ({ ...window, index }))
          .sort((a, b) => Number(usedDays.has(dayKey(a))) - Number(usedDays.has(dayKey(b))) || (dailyLoads.get(dayKey(a)) || 0) - (dailyLoads.get(dayKey(b)) || 0) || a.start - b.start);
        let placed = false;
        for (const window of candidates) {
          const duration = request.minutes * 60000;
          for (let start = Math.ceil(Math.max(window.start, now()) / 900000) * 900000; start + duration <= window.end; start += 900000) {
            const end = start + duration;
            if (occupied.some((block) => start < block.end && end > block.start)) continue;
            const item = normalizeItem({ title:request.title, category:request.category, kind:'time_block', flexibility:request.flexibility, starts_at:new Date(start).toISOString(), ends_at:new Date(end).toISOString(), status:'draft', draft_id:draftId, period_label:input.period_label }, now());
            items.push(item); occupied.push({ start, end }); dailyLoads.set(dayKey(window), (dailyLoads.get(dayKey(window)) || 0) + request.minutes); usedDays.add(dayKey(window)); placed = true;
            break;
          }
          if (placed) break;
        }
        if (!placed) unplaced.push({ title:request.title, minutes:request.minutes, reason:'No opening within your available hours' });
      }
    }
    // Persist the proposal in one hash command; it never modifies commitments.
    if (items.length) await command(['HSET', scopedKey(userId), ...items.flatMap((item) => [item.id, JSON.stringify(item)])]);
    return { draft_id:draftId, items, unplaced, summary:publicSummary(items), period_label:optionalText(input.period_label, 80) || 'your schedule' };
  }

  async function discardWeekDraft(draftId, userId = 'owner') {
    const id = requiredText(draftId, 'draft_id', 120);
    const items = (await listPlannerItems({}, userId)).filter((item) => item.draft_id === id && item.status === 'draft');
    for (const item of items) await deletePlannerItem(item.id, userId);
    return { removed: items.length };
  }

  return { listPlannerItems, previewPlannerItem, createPlannerItem, updatePlannerItem, deletePlannerItem, getScheduleOverview, createWeekDraft, generateScheduleDraft, applyWeekDraft, discardWeekDraft };
}

const liveStore = createPlannerStore();
export const listPlannerItems = liveStore.listPlannerItems;
export const previewPlannerItem = liveStore.previewPlannerItem;
export const createPlannerItem = liveStore.createPlannerItem;
export const updatePlannerItem = liveStore.updatePlannerItem;
export const deletePlannerItem = liveStore.deletePlannerItem;
export const getScheduleOverview = liveStore.getScheduleOverview;
export const createWeekDraft = liveStore.createWeekDraft;
export const generateScheduleDraft = liveStore.generateScheduleDraft;
export const applyWeekDraft = liveStore.applyWeekDraft;
export const discardWeekDraft = liveStore.discardWeekDraft;
export const __internals = { publicSummary, overlaps, scopedKey };
