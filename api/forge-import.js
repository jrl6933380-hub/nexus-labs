// api/forge-import.js
// Bulk lead import from a category + location query, using the
// hand-built Google Places search (lib/forgePlaces.js) instead of a
// third-party scraper. Manager-only, since this is the lead-supply
// side of the operation (MVP item 3).

import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeManager } from '../lib/forgeRoles.js';
import { listLeads, createLead, updateLeadEnrichment } from '../lib/forgeLeads.js';
import { searchBusinesses } from '../lib/forgePlaces.js';

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const username = await getRequestUser(req);
  if (!username || !(await isForgeManager(username))) {
    return res.status(403).json({ error: 'Manager access required.' });
  }

  const { category, location, assignedTo } = req.body || {};
  if (!category || !location) {
    return res.status(400).json({ error: 'category and location are required (e.g. "plumbers", "Tulsa, OK").' });
  }

  try {
    const results = await searchBusinesses(`${category} in ${location}`);
    // Dedupe against every existing lead by phone digits, not the raw
    // string — "(918) 555-0100" and "918-555-0100" are the same lead.
    const existing = await listLeads({ includeSuppressed: true });
    const existingPhones = new Set(existing.map((l) => normalizePhone(l.phone)));

    const created = [];
    const skipped = [];
    for (const result of results) {
      const phoneDigits = normalizePhone(result.phone);
      if (existingPhones.has(phoneDigits)) {
        skipped.push(result.businessName);
        continue;
      }
      const lead = await createLead(
        { ...result, assignedTo: assignedTo || null },
        { createdBy: username }
      );
      const enriched = await updateLeadEnrichment(lead.id, {
        rating: result.rating,
        reviewCount: result.reviewCount,
        placesWebsite: result.website,
      }).catch(() => lead);
      created.push(enriched);
      existingPhones.add(phoneDigits);
    }

    return res.status(200).json({ created, createdCount: created.length, skippedCount: skipped.length, skipped });
  } catch (err) {
    console.error('forge-import handler failed:', err.message);
    return res.status(500).json({ error: err.message || 'Import failed.' });
  }
}
