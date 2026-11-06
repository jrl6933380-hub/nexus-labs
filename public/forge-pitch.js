// Shared, deterministic caller copy. Research findings and preview state stay explicit.
const money = cents => '$' + (cents / 100).toLocaleString('en-US', {maximumFractionDigits: 2});
const noSiteStatuses = new Set(['absent', 'no_website', 'no_dedicated_site_found']);
export function websiteFinding(lead) {
  if (lead.website || lead.placesWebsite) return 'present';
  if (lead.websiteStatus === 'social_booking_only') return 'social';
  if (noSiteStatuses.has(lead.websiteStatus)) return 'not_found';
  return 'unknown';
}
function researchDate(lead) {
  const research = lead.research;
  if (!research?.identity_confirmed || !research.website_confirmed || !research.checked_at) return '';
  const date = new Date(research.checked_at);
  return Number.isNaN(date.getTime()) ? '' : ' (checked ' + date.toISOString().slice(0, 10) + ')';
}
function pricing(offer) {
  if (!Array.isArray(offer?.tiers) || !offer.tiers.length) return 'Check the approved Forge offer before quoting a price.';
  return offer.tiers.map(t => t.name + ': ' + money(t.priceCents) + '/month, website and hosting, ' +
    (t.editsPerMonth === null ? 'unlimited minor edits' : t.editsPerMonth + ' edit' + (t.editsPerMonth === 1 ? '' : 's') + ' per month') +
    (t.aiAssistant ? ', AI assistant included' : '')).join('. ') + '. Confirm the scope and plan before signup.';
}
export function generatePitchScript(lead, offer = null) {
  const name = lead.businessName || 'your business';
  const finding = websiteFinding(lead), date = researchDate(lead);
  const ready = lead.siteStatus === 'ready' && typeof lead.siteHtml === 'string' && !!lead.siteHtml.trim();
  const building = lead.siteStatus === 'generating';
  const category = String(lead.category || '').trim().toLowerCase();
  const audience = ['barber', 'barbers', 'barbershop', 'barbershops'].includes(category) ? 'local barbershops' :
    ['nail salon', 'nail salons', 'nails'].includes(category) ? 'local nail salons' : 'local businesses';
  const weaknesses = [];
  if (finding === 'present') weaknesses.push('A website is on file. Confirm its address and ask what the owner wants to improve.');
  else if (finding === 'social') weaknesses.push('Our research' + date + ' found social or booking pages, but no dedicated business website. Please correct us if we missed it.');
  else if (finding === 'not_found') weaknesses.push('We couldn’t find a dedicated business website in our research' + date + '. Please correct us if we missed it.');
  else weaknesses.push('Website status needs checking. Ask whether they have a website and confirm its address.');
  if (finding === 'social' || finding === 'not_found') weaknesses.push('A dedicated site could put your hours, services, photos and contact details in one place.');
  if (Number.isFinite(lead.rating) && Number.isInteger(lead.reviewCount) && lead.reviewCount >= 5 && lead.rating >= 4 && lead.rating <= 5) {
    weaknesses.push('The saved listing records ' + lead.rating + ' stars from ' + lead.reviewCount + ' reviews. Confirm this is current before quoting it.');
  }
  if (Array.isArray(lead.talkingPoints)) weaknesses.push(...lead.talkingPoints.filter(x => typeof x === 'string').slice(0, 5));
  const pricingLine = pricing(offer);
  return {
    offer,
    opener: `Hi, this is [your name] with Nexus Forge — I help ${audience} like ${name} get found online. Is now a good time for a quick question?`,
    weaknesses,
    discoveryQuestions: [`How are most new customers finding ${name} right now?`,
      finding === 'present' ? 'What would you like your current website to do better?' : finding === 'unknown' ? 'Do you have a website? What address should we check?' : 'Do you have a dedicated website we may have missed?',
      finding === 'present' ? 'How easy is it for someone on a phone to find your hours, services and contact details?' : 'Where do customers currently find your hours, services and contact or booking details?'],
    demoLabel: ready ? 'Show the preview' : 'Offer a preview',
    demoLine: ready ? `There’s a concept preview for ${name} ready here. Would you like me to show you?` :
      building ? `The concept preview for ${name} is still being prepared. We can discuss what you’d like it to include while it finishes.` :
      `We can put together a concept preview for ${name}. Would you like to see what that could look like?`,
    pricingLine,
    objections: [
      {objection: 'We already have a website.', response: 'Thanks for correcting me. What’s the website address? I’ll update our notes. Is there anything about it you want to improve?'},
      {objection: 'We’re not interested.', response: 'Understood — thanks for your time. I’ll note that you’re not interested. If you’d like no further calls, I can record that too.'},
      {objection: 'How much does this cost?', response: pricingLine},
    ],
    upsell: offer?.tiers?.some(t => t.aiAssistant) ? 'The Plus plan includes an AI assistant. We can discuss what you need it to do and confirm the supported features during setup.' : 'Start with the website scope you need. Confirm any optional features and their price before offering them.',
    nextStep: ready ? 'Ask whether the preview is a fit. If they want to continue, confirm the scope and approved plan or agree on a callback time.' : 'Ask permission to prepare a preview and agree on how and when they would like to review it. Record their preference.',
  };
}
