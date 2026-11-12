// Deterministic lead ranking for the Forge scout. Pure code, no model: same lead in, same score and reason out.
// Higher is a better call target: no real website, proof people use the business, and a phone to call.
const BASE = { no_dedicated_site_found: 50, social_booking_only: 35, needs_checking: 20, has_website: 0 };
const WHY = { no_dedicated_site_found: 'No website listed', social_booking_only: 'Social or booking page only', needs_checking: 'Website needs checking', has_website: 'Already has a website' };

export function scoreLead(l) {
  let score = BASE[l.status] ?? 0;
  const parts = [WHY[l.status] || 'Unknown website status'];
  if (l.reviewCount) {
    const reviews = Math.min(30, Math.round(Math.log10(l.reviewCount + 1) * 12));
    const rating = l.rating >= 4.5 ? 10 : l.rating >= 4 ? 5 : 0;
    score += reviews + rating;
    parts.push(`${l.reviewCount} reviews at ${l.rating}`);
  } else parts.push('no reviews listed');
  if (l.phone) { score += 10; parts.push('phone listed'); } else { score -= 15; parts.push('no phone, cannot go on the call list'); }
  return { score: Math.max(0, score), reason: parts.join(' · ') };
}
export const rankLeads = leads => leads.map(l => ({ ...l, ...scoreLead(l) })).sort((a, b) => b.score - a.score);
