// lib/forgeLeads.js
// Lead data model for the Nexus Forge sales workbench MVP. Same
// raw-Redis-REST-over-fetch pattern as lib/board.js / lib/roomAuth.js
// (one Hash, JSON-stringified records, no new dependencies).
//
// Scope note: this is the data model for MVP items 3 (import with
// provenance — schema only, no scraper wired up yet), 7 (call button
// support), and 8 (notes/disposition/follow-up). Scoring (#4),
// pre-generated previews (#5), and the pitch card (#6) are separate,
// later pieces that can hang off leadId once built.

import crypto from 'crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const LEADS_KEY = 'nexus:forge:leads';

// Matches the required dispositions list from the Nexus Forge task.
export const DISPOSITIONS = Object.freeze([
  'no_answer',
  'voicemail_left',
  'follow_up',
  'interested',
  'demo_requested',
  'appointment_booked',
  'not_interested',
  'do_not_call',
  'wrong_number',
  'already_has_provider',
]);
const DISPOSITION_SET = new Set(DISPOSITIONS);

// Dispositions that permanently suppress a lead from being called
// again. Kept intentionally small and conservative — this is not the
// full compliance/suppression system called for in the MVP scope
// (opt-out registries, DNC list sync, etc.), just the minimum so a
// worker's own "do not call" marking sticks.
const SUPPRESSING_DISPOSITIONS = new Set(['do_not_call', 'wrong_number']);

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('forgeLeads redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function listLeads({ assignedTo, includeSuppressed = true } = {}) {
  const raw = await redisCommand(['HGETALL', LEADS_KEY]);
  if (!raw || !Array.isArray(raw)) return [];
  const leads = [];
  for (let i = 0; i < raw.length; i += 2) {
    try {
      leads.push(JSON.parse(raw[i + 1]));
    } catch {
      // skip a malformed entry rather than crashing the whole list
    }
  }
  return leads
    .filter((lead) => !assignedTo || lead.assignedTo === assignedTo)
    .filter((lead) => includeSuppressed || !lead.suppressed)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getLead(id) {
  if (!id) return null;
  const raw = await redisCommand(['HGET', LEADS_KEY, id]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// `source` carries provenance (url + fetchedAt) per the MVP's
// "provenance for every imported fact" requirement. For this pass
// leads are entered by hand (manager pastes in what they found) —
// the automated scraper/enrichment pipeline is deferred, but the
// schema already has a place for it to write into.
export async function createLead(input, { createdBy } = {}) {
  if (!isNonEmptyString(input?.businessName)) {
    throw new Error('businessName is required.');
  }
  if (!isNonEmptyString(input?.phone)) {
    throw new Error('phone is required — this is a calling tool.');
  }
  const now = Date.now();
  const id = `lead_${now}_${crypto.randomBytes(4).toString('hex')}`;
  const lead = {
    id,
    businessName: input.businessName.trim(),
    phone: input.phone.trim(),
    email: isNonEmptyString(input.email) ? input.email.trim() : null,
    website: isNonEmptyString(input.website) ? input.website.trim() : null,
    category: isNonEmptyString(input.category) ? input.category.trim() : null,
    location: isNonEmptyString(input.location) ? input.location.trim() : null,
    websiteStatus: isNonEmptyString(input.websiteStatus) ? input.websiteStatus.trim() : null,
    talkingPoints: Array.isArray(input.talkingPoints)
      ? input.talkingPoints.filter(isNonEmptyString).map((s) => s.trim())
      : [],
    source: {
      url: isNonEmptyString(input.sourceUrl) ? input.sourceUrl.trim() : null,
      importedBy: createdBy || null,
      fetchedAt: now,
    },
    assignedTo: isNonEmptyString(input.assignedTo) ? input.assignedTo.trim() : null,
    status: 'new',
    suppressed: false,
    lastDisposition: null,
    lastContactedAt: null,
    followUpDate: isNonEmptyString(input.followUpDate) ? input.followUpDate : null,
    notes: '',
    history: [],
    createdAt: now,
    updatedAt: now,
  };
  await redisCommand(['HSET', LEADS_KEY, id, JSON.stringify(lead)]);
  return lead;
}

export async function assignLead(id, workerUsername, { by } = {}) {
  const lead = await getLead(id);
  if (!lead) throw new Error('No such lead.');
  lead.assignedTo = workerUsername || null;
  lead.status = workerUsername ? 'assigned' : 'new';
  lead.updatedAt = Date.now();
  lead.history.push({ type: 'assigned', to: workerUsername || null, by: by || null, at: lead.updatedAt });
  await redisCommand(['HSET', LEADS_KEY, id, JSON.stringify(lead)]);
  return lead;
}

// Records a call outcome. This is the core of MVP item 8 (notes,
// disposition, follow-up queue) and feeds item 9's reporting later.
export async function recordDisposition(id, { disposition, notes, followUpDate, by } = {}) {
  if (!DISPOSITION_SET.has(disposition)) {
    throw new Error(`Unknown disposition: ${disposition}`);
  }
  const lead = await getLead(id);
  if (!lead) throw new Error('No such lead.');
  const now = Date.now();
  lead.lastDisposition = disposition;
  lead.lastContactedAt = now;
  lead.status = disposition;
  if (isNonEmptyString(notes)) lead.notes = notes.trim();
  lead.followUpDate = isNonEmptyString(followUpDate) ? followUpDate : null;
  if (SUPPRESSING_DISPOSITIONS.has(disposition)) lead.suppressed = true;
  lead.updatedAt = now;
  lead.history.push({ type: 'disposition', disposition, by: by || null, at: now });
  await redisCommand(['HSET', LEADS_KEY, id, JSON.stringify(lead)]);
  return lead;
}
