// api/forge-leads.js
// Worker/manager surface for the Nexus Forge lead workbench (MVP
// items 7 + 8: call button support, notes/disposition/follow-up).
// Auth reuses the existing Room session cookie — no new login system.
//
// GET    /api/forge-leads              -> caller's own assigned leads
// GET    /api/forge-leads?scope=all    -> manager only: every lead
// POST   /api/forge-leads              -> manager only: create a lead
// PATCH  /api/forge-leads              -> record a disposition, or
//                                          (manager only) reassign

import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeWorker, isForgeManager } from '../lib/forgeRoles.js';
import { createLead, listLeads, assignLead, recordDisposition, updateLeadEnrichment } from '../lib/forgeLeads.js';
import { generatePitchScript } from '../lib/forgePitch.js';
import { fetchBusinessSignals } from '../lib/forgePlaces.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const username = await getRequestUser(req);
  if (!username) return res.status(401).json({ error: 'Sign in required.' });

  const [worker, manager] = await Promise.all([isForgeWorker(username), isForgeManager(username)]);
  if (!worker) return res.status(403).json({ error: 'Not a Forge account. Ask a manager to grant access.' });

  try {
    if (req.method === 'GET') {
      const wantsAll = req.query?.scope === 'all';
      if (wantsAll && !manager) return res.status(403).json({ error: 'Manager access required.' });
      const leads = await listLeads(wantsAll ? {} : { assignedTo: username });
      const withPitch = leads.map((lead) => ({ ...lead, pitch: generatePitchScript(lead) }));
      return res.status(200).json({ leads: withPitch });
    }

    if (req.method === 'POST') {
      if (!manager) return res.status(403).json({ error: 'Manager access required.' });
      const lead = await createLead(req.body || {}, { createdBy: username });
      // Best-effort enrichment — never blocks or fails lead creation.
      // If GOOGLE_PLACES_API_KEY isn't set, or the lookup finds nothing,
      // this just leaves rating/reviewCount/placesWebsite as null.
      let enriched = lead;
      const signals = await fetchBusinessSignals(lead.businessName, lead.location).catch(() => null);
      if (signals) {
        enriched = await updateLeadEnrichment(lead.id, {
          rating: signals.rating,
          reviewCount: signals.reviewCount,
          placesWebsite: signals.website,
        }).catch(() => lead);
      }
      return res.status(201).json({ lead: enriched });
    }

    if (req.method === 'PATCH') {
      const { id, disposition, notes, followUpDate, assignedTo } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required.' });

      if (assignedTo !== undefined) {
        if (!manager) return res.status(403).json({ error: 'Manager access required to reassign.' });
        const lead = await assignLead(id, assignedTo, { by: username });
        return res.status(200).json({ lead });
      }

      const lead = await recordDisposition(id, { disposition, notes, followUpDate, by: username });
      return res.status(200).json({ lead });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('forge-leads handler failed:', err.message);
    return res.status(400).json({ error: err.message || 'Request failed.' });
  }
}
