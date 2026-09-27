// lib/forgeDb.js
// Supabase (Postgres) data layer for the Forge caller program.
// Same no-dependency fetch pattern as lib/rooms.js. Server-only: uses
// the service role key, and every forge_* table has RLS on with no
// policies, so the anon/public key can read nothing.
//
// Login/identity stays in Redis (lib/roomAuth.js); a caller row links
// to it through forge_username.

import {
  TIERS, tierOf, signupBonusCents, upgradeBonusCents, recurringCommissionCents,
  cancelTimeline, reactivationTiers, GRACE_DAYS,
} from './forgeProgram.js';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Forge DB not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return { base: `${url.replace(/\/$/u, '')}/rest/v1`, key };
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const { base, key } = config();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${base}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.message || `HTTP ${res.status}`;
    throw new Error(`forgeDb ${method} ${path.split('?')[0]}: ${msg}`);
  }
  return data;
}

const one = (rows) => (Array.isArray(rows) ? rows[0] || null : rows);
const enc = encodeURIComponent;
const dollars = (cents) => (cents / 100).toFixed(2);

// ---------- callers ----------
export async function getCallerByUsername(username) {
  return one(await rest(`forge_callers?forge_username=eq.${enc(username)}&select=*`));
}
export async function getCaller(id) {
  return one(await rest(`forge_callers?id=eq.${enc(id)}&select=*`));
}
export async function createCaller({ forgeUsername, displayName }) {
  return one(await rest('forge_callers', {
    method: 'POST', prefer: 'return=representation',
    body: { forge_username: forgeUsername, display_name: displayName },
  }));
}

// ---------- state gating ----------
export async function isStateCleared(stateCode) {
  if (!stateCode) return false;
  const row = one(await rest(`forge_state_clearances?state_code=eq.${enc(String(stateCode).toUpperCase())}&select=state_code`));
  return Boolean(row);
}

// ---------- commission ledger ----------
// Idempotent by (event_type, source_ref): a retried Stripe webhook or a
// double-tapped button re-sends the same source_ref and is ignored.
export async function recordCommission({ callerId, clientId, eventType, amountCents, tier, sourceRef }) {
  if (!sourceRef) throw new Error('sourceRef is required for idempotent commission events.');
  if (!(amountCents > 0)) return null;
  const rows = await rest('forge_commission_events?on_conflict=event_type,source_ref', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { caller_id: callerId, client_id: clientId, event_type: eventType, amount: dollars(amountCents), tier_at_event: tier, source_ref: sourceRef },
  });
  return one(rows); // null when it was a duplicate
}

async function logStatus(clientId, fromStatus, toStatus, tier, changedBy) {
  await rest('forge_client_status_log', {
    method: 'POST',
    body: { client_id: clientId, from_status: fromStatus, to_status: toStatus, tier, changed_by: changedBy },
  });
}

async function patchClient(clientId, fields) {
  return one(await rest(`forge_clients?id=eq.${enc(clientId)}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { ...fields, updated_at: new Date().toISOString() },
  }));
}

export async function getClient(id) {
  return one(await rest(`forge_clients?id=eq.${enc(id)}&select=*`));
}

// ---------- lifecycle ----------
// A lead says yes: create the client in pending_payment. No money is
// owed yet -- the signup bonus is recorded only when the first invoice
// is actually paid (recordPaidInvoice), so an unpaid "yes" costs nothing.
export async function convertLead({ leadId, callerId, tier, draftId = null }) {
  tierOf(tier);
  const lead = one(await rest(`forge_leads?id=eq.${enc(leadId)}&select=*`));
  if (!lead) throw new Error('Lead not found.');
  if (lead.status === 'converted') throw new Error('Lead is already a client.');
  const caller = await getCaller(callerId);
  if (!caller) throw new Error('Caller not found.');

  const client = one(await rest('forge_clients', {
    method: 'POST', prefer: 'return=representation',
    body: {
      lead_id: lead.id, draft_id: draftId, business_name: lead.business_name, phone: lead.phone,
      tier, ai_assistant_addon: TIERS[tier].aiAssistant, status: 'pending_payment',
      landed_by: caller.id, commission_owner: caller.id, assigned_to: caller.id,
    },
  }));
  await rest(`forge_leads?id=eq.${enc(lead.id)}`, { method: 'PATCH', body: { status: 'converted', updated_at: new Date().toISOString() } });
  await logStatus(client.id, null, 'pending_payment', tier, caller.forge_username);
  return client;
}

// Tier upgrade: bonus goes to whoever closed it (may be a covering rep);
// the recurring cut stays with commission_owner.
export async function upgradeClient({ clientId, toTier, closedByCallerId, sourceRef }) {
  const client = await getClient(clientId);
  if (!client) throw new Error('Client not found.');
  if (tierOf(toTier).rank <= tierOf(client.tier).rank) throw new Error('Use a downgrade path for lower tiers.');
  const closer = await getCaller(closedByCallerId);
  const updated = await patchClient(clientId, { tier: toTier, ai_assistant_addon: client.ai_assistant_addon || TIERS[toTier].aiAssistant });
  await logStatus(clientId, client.status, client.status, toTier, closer.forge_username);
  await recordCommission({
    callerId: closer.id, clientId, eventType: 'upgrade_bonus',
    amountCents: upgradeBonusCents(closer, client.tier, toTier), tier: toTier,
    sourceRef: sourceRef || `upgrade:${clientId}:${client.tier}->${toTier}`,
  });
  return updated;
}

// Day 0: cancel requested. Site stays live through the grace period.
export async function requestCancel({ clientId, changedBy, at = new Date() }) {
  const client = await getClient(clientId);
  if (!client) throw new Error('Client not found.');
  if (client.status !== 'active') throw new Error(`Cannot cancel a client in status "${client.status}".`);
  const { followupDueAt } = cancelTimeline(at);
  const updated = await patchClient(clientId, {
    status: 'canceling', cancel_requested_at: new Date(at).toISOString(), followup_due_at: followupDueAt.toISOString(),
  });
  await logStatus(clientId, 'active', 'canceling', client.tier, changedBy);
  return updated;
}

// Day 3 (run by the daily sweep): drop to the name + phone placeholder.
export async function moveToPlaceholder({ clientId, changedBy = 'system' }) {
  const client = await getClient(clientId);
  if (client?.status !== 'canceling') return null;
  const updated = await patchClient(clientId, { status: 'placeholder', placeholder_started_at: new Date().toISOString() });
  await logStatus(clientId, 'canceling', 'placeholder', client.tier, changedBy);
  return updated;
}

// Day 14 call outcome "no" or no answer: take it down for real.
export async function churnClient({ clientId, changedBy }) {
  const client = await getClient(clientId);
  if (!client || !['canceling', 'placeholder'].includes(client.status)) throw new Error('Client is not in the cancel window.');
  const updated = await patchClient(clientId, { status: 'churned', churned_at: new Date().toISOString(), followup_due_at: null });
  await logStatus(clientId, client.status, 'churned', client.tier, changedBy);
  return updated;
}

// Support Nex or a rep brings them back: same tier or lower, no new
// signup bonus. Recurring resumes for commission_owner automatically.
export async function reactivateClient({ clientId, tier, changedBy }) {
  const client = await getClient(clientId);
  if (!client || !['canceling', 'placeholder'].includes(client.status)) throw new Error('Only clients in the cancel window can be reactivated.');
  const newTier = tier || client.tier;
  if (!reactivationTiers(client.tier).includes(newTier)) throw new Error('Reactivation can only keep the same tier or go lower. Upgrades go through a rep.');
  const updated = await patchClient(clientId, {
    status: 'active', tier: newTier, cancel_requested_at: null, placeholder_started_at: null, followup_due_at: null,
  });
  await logStatus(clientId, client.status, 'active', newTier, changedBy);
  return updated;
}

// Permanent handoff (rep leaves): recurring moves to the new owner from
// now on; everything already earned stays with the old owner.
export async function transferOwnership({ clientId, toCallerId, reason, transferredBy }) {
  const client = await getClient(clientId);
  if (!client) throw new Error('Client not found.');
  if (client.commission_owner === toCallerId) return client;
  await rest('forge_ownership_transfers', {
    method: 'POST',
    body: { client_id: clientId, from_caller_id: client.commission_owner, to_caller_id: toCallerId, reason, transferred_by: transferredBy },
  });
  return patchClient(clientId, { commission_owner: toCallerId, assigned_to: toCallerId });
}

// Day-to-day follow-up assignment. Never touches money.
export async function assignFollowUp({ clientId, callerId }) {
  return patchClient(clientId, { assigned_to: callerId });
}

// Any Forge worker becomes a caller the first time they need one, so
// adding a new rep is just creating their Forge worker account.
export async function ensureCaller(username) {
  const existing = await getCallerByUsername(username);
  if (existing) return existing;
  const rows = await rest('forge_callers?on_conflict=forge_username', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: { forge_username: username, display_name: username },
  });
  return one(rows);
}

// Bridge: Forge Field leads still live in Redis (lib/forgeLeads.js).
// Copy one into Postgres at conversion time; unique(phone,
// business_name) makes this safe to repeat.
export async function upsertLeadFromRedis(redisLead, callerId) {
  if (!redisLead?.businessName || !redisLead?.phone) throw new Error('Lead is missing a business name or phone.');
  const rows = await rest('forge_leads?on_conflict=phone,business_name', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      caller_id: callerId,
      business_name: redisLead.businessName,
      phone: redisLead.phone,
      category: redisLead.category || null,
      address: redisLead.location || null,
      has_website: Boolean(redisLead.website || redisLead.placesWebsite),
      website_url: redisLead.website || redisLead.placesWebsite || null,
      review_count: redisLead.reviewCount ?? null,
      review_rating: redisLead.rating ?? null,
      source: { redisLeadId: redisLead.id, ...(redisLead.source || {}) },
      updated_at: new Date().toISOString(),
    },
  });
  return one(rows);
}

// ---------- payments (called from the Stripe webhook) ----------
export async function setClientCheckout(clientId, checkoutUrl) {
  return patchClient(clientId, { checkout_url: checkoutUrl });
}

// One paid invoice. First payment activates the client and earns the
// landing caller's signup bonus; every payment earns the current
// commission owner 15%. Both are idempotent (signup:<client>,
// invoice:<invoice>), so Stripe retries are harmless. Returns only the
// commission rows newly created by this call, ready to be paid out.
export async function recordPaidInvoice({ clientId, invoiceId, customerId, subscriptionId, amountPaidCents, isFirst }) {
  const client = await getClient(clientId);
  if (!client) return { client: null, events: [] };

  let current = client;
  if (client.status === 'pending_payment') {
    current = await patchClient(clientId, {
      status: 'active', paid_at: new Date().toISOString(), checkout_url: null,
      stripe_customer_id: customerId, stripe_subscription_id: subscriptionId,
    });
    await logStatus(clientId, 'pending_payment', 'active', client.tier, 'stripe');
  }

  const events = [];
  if (isFirst) {
    const lander = await getCaller(client.landed_by);
    const bonus = await recordCommission({
      callerId: lander.id, clientId, eventType: 'signup_bonus',
      amountCents: signupBonusCents(lander, client.tier), tier: client.tier, sourceRef: `signup:${clientId}`,
    });
    if (bonus) events.push({ event: bonus, caller: lander });
  }

  const owner = await getCaller(client.commission_owner);
  const recurring = await recordCommission({
    callerId: owner.id, clientId, eventType: 'recurring',
    amountCents: recurringCommissionCents(owner, amountPaidCents), tier: client.tier, sourceRef: `invoice:${invoiceId}`,
  });
  if (recurring) events.push({ event: recurring, caller: owner });

  return { client: current, events };
}

export async function setCallerConnectAccount(callerId, accountId) {
  return one(await rest(`forge_callers?id=eq.${enc(callerId)}`, {
    method: 'PATCH', prefer: 'return=representation', body: { stripe_connect_account_id: accountId },
  }));
}

export async function markCommission(eventId, { status, transferId = null }) {
  await rest(`forge_commission_events?id=eq.${enc(eventId)}`, {
    method: 'PATCH', body: { status, stripe_transfer_id: transferId },
  });
}

export async function getClientBySubscription(subscriptionId) {
  return one(await rest(`forge_clients?stripe_subscription_id=eq.${enc(subscriptionId)}&select=*`));
}

// ---------- operator views ----------
export async function listClients({ status, ownerId, assignedTo } = {}) {
  const filters = ['select=*', 'order=signed_up_at.desc'];
  if (status) filters.push(`status=eq.${enc(status)}`);
  if (ownerId) filters.push(`commission_owner=eq.${enc(ownerId)}`);
  if (assignedTo) filters.push(`assigned_to=eq.${enc(assignedTo)}`);
  return rest(`forge_clients?${filters.join('&')}`);
}

export async function dueFollowUps(now = new Date()) {
  return rest(`forge_clients?status=eq.placeholder&followup_due_at=lte.${enc(now.toISOString())}&select=*`);
}

// Clients whose 3-day live grace period is over and should drop to the
// name + phone placeholder. Run by /api/forge-sweep.
export async function dueForPlaceholder(now = new Date()) {
  const cutoff = new Date(now.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  return rest(`forge_clients?status=eq.canceling&cancel_requested_at=lte.${enc(cutoff.toISOString())}&select=id`);
}

export async function commissionOwed(callerId) {
  const rows = await rest(`forge_commission_events?caller_id=eq.${enc(callerId)}&status=eq.pending&select=amount`);
  return Math.round(rows.reduce((sum, r) => sum + Number(r.amount) * 100, 0));
}

export async function listCallers() {
  return rest('forge_callers?select=id,forge_username,display_name,status,created_at&order=created_at.asc');
}

// Operator rollup: every caller with active clients, MRR they own, and
// pending commission. One query per table, grouped in memory; fine
// into the thousands of clients.
export async function callerSummaries() {
  const [callers, clients, pending] = await Promise.all([
    listCallers(),
    rest('forge_clients?select=commission_owner,tier,status'),
    rest('forge_commission_events?status=eq.pending&select=caller_id,amount'),
  ]);
  return callers.map((c) => {
    const active = clients.filter((cl) => cl.commission_owner === c.id && cl.status === 'active');
    const owedCents = Math.round(pending.filter((p) => p.caller_id === c.id).reduce((s, p) => s + Number(p.amount) * 100, 0));
    const mrrCents = active.reduce((s, cl) => s + (TIERS[cl.tier]?.priceCents || 0), 0);
    return { ...c, activeClients: active.length, mrrCents, owedCents };
  });
}
