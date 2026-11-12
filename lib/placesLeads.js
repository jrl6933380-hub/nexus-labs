// Lead finder backed by the Google Places API (New): structured results, no browser, no model.
// A place with no website field is a lead; social/booking-only pages are flagged. Read-only; nothing is sent.
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.googleMapsUri';
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|tiktok\.com|x\.com|twitter\.com|linktr\.ee|booksy\.com|genbook\.com|vagaro\.com|fresha\.com|styleseat\.com|schedulicity\.com|squareup\.com|square\.site|getsquire\.com|setmore\.com|thecut\.co|yelp\.com|mapquest\.com|yellowpages\.com)$/i;
const TEXT = /^[\p{L}\p{N} .,'&-]{2,100}$/u;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export function spec(input = {}) {
  const business = String(input.business ?? '').trim(), city = String(input.city ?? '').trim(), count = Number(input.count ?? 10);
  if (!TEXT.test(business) || !TEXT.test(city) || !Number.isInteger(count) || count < 1 || count > 10) throw bad('Enter a business type, a city and 1-10 results.');
  return { business, city, count };
}
export function classify(place) {
  const raw = place.websiteUri;
  if (!raw) return { status: 'no_dedicated_site_found', website: '', notes: 'Google lists no website for this business. Confirm on the call.' };
  let host = '';
  try { host = new URL(raw).hostname; } catch { return { status: 'needs_checking', website: '', notes: 'Google lists a website address that could not be read.' }; }
  if (SOCIAL.test(host)) return { status: 'social_booking_only', website: raw, notes: `Google lists only ${host.replace(/^www\./, '')}, not a business-owned site.` };
  return { status: 'has_website', website: raw, notes: 'Google lists a business website.' };
}
const ORDER = { no_dedicated_site_found: 0, social_booking_only: 1, needs_checking: 2, has_website: 3 };
export function leadsFrom(data, count) {
  const places = Array.isArray(data?.places) ? data.places : [];
  const seen = new Set(), out = [];
  for (const p of places) {
    const name = String(p?.displayName?.text || '').trim().slice(0, 120);
    if (!name || (p.businessStatus && p.businessStatus !== 'OPERATIONAL')) continue;
    const key = String(p.id || name).toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    out.push({ name, address: String(p.formattedAddress || '').slice(0, 200), phone: String(p.nationalPhoneNumber || '').slice(0, 40),
      rating: Number.isFinite(p.rating) && Number.isInteger(p.userRatingCount) && p.userRatingCount > 0 ? p.rating : null,
      reviewCount: Number.isInteger(p.userRatingCount) && p.userRatingCount > 0 && Number.isFinite(p.rating) ? p.userRatingCount : null,
      map_url: typeof p.googleMapsUri === 'string' && p.googleMapsUri.startsWith('https://') ? p.googleMapsUri : '', ...classify(p) });
  }
  return out.sort((a, b) => ORDER[a.status] - ORDER[b.status]).slice(0, count);
}
export async function searchPlaces(input, { key = process.env.GOOGLE_PLACES_API_KEY, fetchImpl = fetch } = {}) {
  const s = spec(input);
  if (!key) throw bad('Google Places key is not set.', 503);
  let r;
  try {
    r = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify({ textQuery: `${s.business} in ${s.city}`, maxResultCount: 20, languageCode: 'en', regionCode: 'US' }), signal: AbortSignal.timeout(15000) });
  } catch { throw bad('Could not reach Google Places.', 502); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = data?.error?.status || ('HTTP ' + r.status);
    throw bad(`Google Places refused the search (${String(code).slice(0, 40)}). ${String(data?.error?.message || '').replace(/AIza[\w-]+/g, '[key]').slice(0, 160)}`, r.status === 429 ? 429 : 502);
  }
  const leads = leadsFrom(data, s.count);
  return { query: s, found: Array.isArray(data.places) ? data.places.length : 0, leads, counts: leads.reduce((m, l) => (m[l.status] = (m[l.status] || 0) + 1, m), {}) };
}
