// Saves a built Places lead into the existing Forge lead list (Forge -> Leads), with its three site looks.
// Never calls, sends or publishes anything. A lead with no phone cannot go in the call list.
import { listLeads, createLead, updateLeadEnrichment, updateLeadSite } from './forgeLeads.js';

const digits = s => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

export async function saveBuiltLead({ lead, built, createdBy }, deps = {}) {
  const { list = listLeads, create = createLead, enrich = updateLeadEnrichment, site = updateLeadSite } = deps;
  if (!lead.phone) return { status: 'skipped', message: 'Not saved: Google lists no phone number, and the call list needs one.' };
  const existing = (await list()).find(l => digits(l.phone) === digits(lead.phone) && String(l.businessName).toLowerCase() === lead.name.toLowerCase());
  if (existing) return { status: 'already', leadId: existing.id, message: 'Already in your Forge leads, so I did not add it again.' };
  const saved = await create({
    businessName: lead.name, phone: lead.phone, category: lead.business, location: lead.city,
    websiteStatus: lead.status, sourceUrl: lead.mapUrl || undefined,
    siteContent: built.siteContent || (lead.address ? { address: lead.address } : undefined),
    talkingPoints: []
  }, { createdBy: createdBy || 'owner' });
  if (lead.rating) await enrich(saved.id, { rating: lead.rating, reviewCount: lead.reviewCount });
  await site(saved.id, { html: built.previews[0].html, status: 'ready', variants: built.previews, templateId: built.previews[0].id });
  return { status: 'saved', leadId: saved.id, message: 'Saved to Forge → Leads with its three looks.' };
}
