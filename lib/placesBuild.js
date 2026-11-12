// Turns one Google Places lead into three concept site previews and a call pitch.
// Deterministic: no model, no network, nothing saved, sent or published.
import { generateSiteVariants } from '../public/site-compose.mjs';
import { generatePitchScript } from '../public/forge-pitch.js';

const TEXT = /^[\p{L}\p{N} .,'&-]{2,100}$/u;
const SHORT = /^[\p{L}\p{N} .,'&-]{2,40}$/u;
const PHONE = /^[0-9+().\-\s]{7,30}$/;
const OK_STATUS = new Set(['no_dedicated_site_found', 'social_booking_only', 'needs_checking']);
const bad = message => Object.assign(new Error(message), { status: 400 });
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function readLead(input = {}) {
  const l = input.lead && typeof input.lead === 'object' && !Array.isArray(input.lead) ? input.lead : null;
  if (!l) throw bad('Choose a lead to build.');
  const name = clean(l.name, 100), business = clean(input.business, 100), city = clean(input.city, 100);
  if (!TEXT.test(name) || !SHORT.test(business) || !SHORT.test(city)) throw bad('The lead needs a name, a business type and a city.');
  if (l.status === 'has_website') throw bad(`${name} already has a website, so no pitch was built.`);
  if (!OK_STATUS.has(l.status)) throw bad('Unknown website status for this lead.');
  const phone = clean(l.phone, 40);
  const reviewCount = Number.isInteger(l.reviewCount) && l.reviewCount > 0 ? l.reviewCount : null;
  const rating = reviewCount && Number.isFinite(l.rating) && l.rating > 0 && l.rating <= 5 ? l.rating : null;
  const mapUrl = typeof l.map_url === 'string' && /^https:\/\/[^\s"'<>]{1,500}$/.test(l.map_url) ? l.map_url : '';
  return { name, business, city, status: l.status, phone: PHONE.test(phone) ? phone : '', address: clean(l.address, 200), rating, reviewCount: rating ? reviewCount : null, mapUrl };
}

export function pitchText(lead, pitch) {
  const listing = [
    lead.phone && `Phone: ${lead.phone}`,
    lead.address && `Address: ${lead.address}`,
    lead.rating && `Google rating: ${lead.rating} from ${lead.reviewCount} reviews`,
    lead.mapUrl && `Map: ${lead.mapUrl}`
  ].filter(Boolean);
  return [`PITCH FOR ${lead.name}`, '',
    'LISTING (from Google Places, confirm on the call)', ...(listing.length ? listing.map(x => '- ' + x) : ['- Nothing usable listed']), '',
    pitch.opener, '', 'WHAT WE FOUND', ...pitch.weaknesses.map(x => '- ' + x), '',
    'DISCOVERY QUESTIONS', ...pitch.discoveryQuestions.map(x => '- ' + x), '',
    pitch.demoLabel.toUpperCase(), pitch.demoLine, '', 'PRICING', pitch.pricingLine, '',
    'OBJECTIONS', ...pitch.objections.map(o => `- "${o.objection}" -> ${o.response}`), '',
    'UPSELL', pitch.upsell, '', 'NEXT STEP', pitch.nextStep, '',
    'Nothing has been sent. The previews are samples, not the business\'s own photos or services. Confirm the business and its website status yourself before any call.'].join('\n');
}

export function buildFromPlace(input) {
  const lead = readLead(input);
  const siteLead = {
    businessName: lead.name, category: lead.business, location: lead.city,
    phone: lead.phone, rating: lead.rating, reviewCount: lead.reviewCount,
    siteContent: lead.address ? { address: lead.address } : undefined
  };
  const variants = generateSiteVariants(siteLead);
  const pitch = generatePitchScript({
    ...siteLead, websiteStatus: lead.status, siteStatus: 'ready', siteHtml: variants[0].html,
    research: { identity_confirmed: false, website_confirmed: false }
  });
  return {
    name: lead.name,
    previews: variants.map(v => ({ id: v.id, label: v.label, html: v.html })),
    pitch: pitchText(lead, pitch)
  };
}
