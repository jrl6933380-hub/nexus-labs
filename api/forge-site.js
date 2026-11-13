// api/forge-site.js
// Generates or live-edits a lead's demo site (MVP item 5). Restricted
// to the lead's assigned worker or a manager — same access rule as
// api/forge-leads.js's disposition endpoint.

import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeWorker, isForgeManager } from '../lib/forgeRoles.js';
import { getLead, updateLeadSite } from '../lib/forgeLeads.js';
import { generateSiteHtml, editSiteHtml } from '../lib/forgeSitePreview.js';
import { generateSiteVariants, renderSiteVariant } from '../public/site-compose.mjs';
import { PALETTES } from '../public/site-vocabulary.mjs';
import { cleanCustomize } from '../lib/forgeCustomize.js';
import { stockPhotosFor } from '../lib/stockPhotos.js';

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

  const { leadId, action, instruction, templateId, changes } = req.body || {};
  if (!leadId) return res.status(400).json({ error: 'leadId is required.' });

  try {
    const lead = await getLead(leadId);
    if (!lead) return res.status(404).json({ error: 'No such lead.' });
    if (!(await canAccessLead(lead, username, manager))) {
      return res.status(403).json({ error: 'This lead is not assigned to you.' });
    }

    if (action === 'templates') {
      // First build gets credited stock photos for the trade so the demo looks finished. Existing photos are kept.
      let siteContent = lead.siteContent;
      if (!(siteContent?.photos || []).length) {
        const photos = await stockPhotosFor(lead.category, lead.businessName);
        if (photos.length) siteContent = { ...(siteContent || {}), photos };
      }
      const probe = siteContent === lead.siteContent ? lead : { ...lead, siteContent };
      const variants = generateSiteVariants(probe);
      const updated = await updateLeadSite(leadId, {
        html: variants[0].html, status: 'ready', variants, templateId: variants[0].id, siteContent,
      });
      return res.status(200).json({ lead: updated });
    }

    if (action === 'select_template') {
      const selected = (lead.siteVariants || []).find(item => item.id === templateId);
      if (!selected) return res.status(400).json({ error: 'Choose one of this lead’s saved previews.' });
      const updated = await updateLeadSite(leadId, { html: selected.html, status: 'ready', templateId: selected.id });
      return res.status(200).json({ lead: updated });
    }

    if (action === 'generate') {
      await updateLeadSite(leadId, { status: 'generating' });
      try {
        const html = await generateSiteHtml(lead);
        const updated = await updateLeadSite(leadId, { html, status: 'ready', variants: [], templateId: null });
        return res.status(200).json({ lead: updated });
      } catch (err) {
        await updateLeadSite(leadId, { status: 'error' });
        throw err;
      }
    }

    if (action === 'customize') {
      const c = cleanCustomize(changes, PALETTES.map(p => p.id));
      if (c.error) return res.status(400).json({ error: c.error });
      const siteContent = { ...(lead.siteContent || {}), ...c.content };
      const sitePalette = c.palette !== undefined ? c.palette : (lead.sitePalette || '');
      const probe = { ...lead, siteContent };
      const ids = (lead.siteVariants || []).length ? lead.siteVariants.map(v => v.id) : generateSiteVariants(probe).map(v => v.id);
      let variants;
      try {
        variants = ids.map(id => {
          const base = generateSiteVariants(probe).find(v => v.id === id) || {};
          const html = renderSiteVariant(probe, id, sitePalette ? { theme: { palette: sitePalette } } : {});
          return { id, label: base.label || id, description: base.description || '', html };
        });
      } catch (err) {
        return res.status(400).json({ error: 'That wording can’t go on a sample preview: ' + String(err.message || err).replace(/^Composer produced an invalid site: /, '').slice(0, 160) });
      }
      const keep = (lead.siteTemplateId && variants.find(v => v.id === lead.siteTemplateId)) || variants[0];
      const updated = await updateLeadSite(leadId, { html: keep.html, status: 'ready', variants, templateId: keep.id, siteContent, sitePalette });
      return res.status(200).json({ lead: updated });
    }

    if (action === 'edit') {
      if (!lead.siteHtml) return res.status(400).json({ error: 'Generate a site before editing it.' });
      const html = await editSiteHtml(lead.siteHtml, instruction);
      const updated = await updateLeadSite(leadId, { html, status: 'ready' });
      return res.status(200).json({ lead: updated });
    }

    return res.status(400).json({ error: 'action must be "templates", "select_template", "customize", "generate" or "edit".' });
  } catch (err) {
    console.error('forge-site handler failed:', err.message);
    return res.status(500).json({ error: err.message || 'Site generation failed.' });
  }
}

