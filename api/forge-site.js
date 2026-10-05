// api/forge-site.js
// Generates or live-edits a lead's demo site (MVP item 5). Restricted
// to the lead's assigned worker or a manager — same access rule as
// api/forge-leads.js's disposition endpoint.

import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeWorker, isForgeManager } from '../lib/forgeRoles.js';
import { getLead, updateLeadSite } from '../lib/forgeLeads.js';
import { generateSiteHtml, editSiteHtml } from '../lib/forgeSitePreview.js';

async function canAccessLead(lead, username, manager) {
  return manager || lead.assignedTo === username;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const username = await getRequestUser(req);
  if (!username) return res.status(401).json({ error: 'Sign in required.' });
  const [worker, manager] = await Promise.all([isForgeWorker(username), isForgeManager(username)]);
  if (!worker) return res.status(403).json({ error: 'Not a Forge account.' });

  const { leadId, action, instruction } = req.body || {};
  if (!leadId) return res.status(400).json({ error: 'leadId is required.' });

  try {
    const lead = await getLead(leadId);
    if (!lead) return res.status(404).json({ error: 'No such lead.' });
    if (!(await canAccessLead(lead, username, manager))) {
      return res.status(403).json({ error: 'This lead is not assigned to you.' });
    }

    if (action === 'generate') {
      await updateLeadSite(leadId, { status: 'generating' });
      try {
        const html = await generateSiteHtml(lead);
        const updated = await updateLeadSite(leadId, { html, status: 'ready' });
        return res.status(200).json({ lead: updated });
      } catch (err) {
        await updateLeadSite(leadId, { status: 'error' });
        throw err;
      }
    }

    if (action === 'edit') {
      if (!lead.siteHtml) return res.status(400).json({ error: 'Generate a site before editing it.' });
      const html = await editSiteHtml(lead.siteHtml, instruction);
      const updated = await updateLeadSite(leadId, { html, status: 'ready' });
      return res.status(200).json({ lead: updated });
    }

    return res.status(400).json({ error: 'action must be "generate" or "edit".' });
  } catch (err) {
    console.error('forge-site handler failed:', err.message);
    return res.status(500).json({ error: err.message || 'Site generation failed.' });
  }
}
