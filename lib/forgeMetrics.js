// lib/forgeMetrics.js
// Aggregates lib/forgeLeads.js data into the numbers an owner/operator
// actually needs to run the sales operation — MVP item 9 ("basic
// manager reporting"). Pure aggregation over listLeads(); no new
// storage. Kept intentionally simple (no date-range filters, no
// campaigns/territories yet — those don't exist in the data model
// yet either) so it's correct today rather than complete.

import { listLeads, DISPOSITIONS } from './forgeLeads.js';

function emptyDispositionCounts() {
  const counts = {};
  for (const d of DISPOSITIONS) counts[d] = 0;
  return counts;
}

export async function getForgeMetrics() {
  const leads = await listLeads({ includeSuppressed: true });
  const now = Date.now();

  const totals = {
    leads: leads.length,
    assigned: leads.filter((l) => l.assignedTo).length,
    unassigned: leads.filter((l) => !l.assignedTo).length,
    suppressed: leads.filter((l) => l.suppressed).length,
    contacted: leads.filter((l) => l.lastContactedAt).length,
    neverContacted: leads.filter((l) => !l.lastContactedAt).length,
  };

  const byDisposition = emptyDispositionCounts();
  for (const lead of leads) {
    if (lead.lastDisposition) byDisposition[lead.lastDisposition] = (byDisposition[lead.lastDisposition] || 0) + 1;
  }

  const funnelStages = ['assigned', 'interested', 'demo_requested', 'appointment_booked'];
  const funnel = {};
  for (const stage of funnelStages) {
    if (stage === 'assigned') {
      funnel.assigned = totals.assigned;
      continue;
    }
    funnel[stage] = leads.filter((l) => l.history?.some((h) => h.type === 'disposition' && h.disposition === stage)).length;
  }

  const byWorkerMap = new Map();
  for (const lead of leads) {
    if (!lead.assignedTo) continue;
    if (!byWorkerMap.has(lead.assignedTo)) {
      byWorkerMap.set(lead.assignedTo, { username: lead.assignedTo, assigned: 0, contacted: 0, byDisposition: emptyDispositionCounts() });
    }
    const worker = byWorkerMap.get(lead.assignedTo);
    worker.assigned += 1;
    if (lead.lastContactedAt) worker.contacted += 1;
    if (lead.lastDisposition) worker.byDisposition[lead.lastDisposition] += 1;
  }
  const byWorker = Array.from(byWorkerMap.values()).sort((a, b) => b.assigned - a.assigned);

  const followUpQueue = leads
    .filter((l) => l.followUpDate && !l.suppressed)
    .map((l) => ({
      id: l.id,
      businessName: l.businessName,
      phone: l.phone,
      assignedTo: l.assignedTo,
      followUpDate: l.followUpDate,
      overdue: new Date(l.followUpDate).getTime() < now,
    }))
    .sort((a, b) => new Date(a.followUpDate) - new Date(b.followUpDate));

  const recentActivity = leads
    .flatMap((l) => (l.history || []).map((h) => ({ ...h, leadId: l.id, businessName: l.businessName })))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 25);

  return { totals, byDisposition, funnel, byWorker, followUpQueue, recentActivity, generatedAt: now };
}
