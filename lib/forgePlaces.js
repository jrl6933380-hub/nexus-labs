// lib/forgePlaces.js
// Free/cheap business signal lookup for lead enrichment — rating,
// review count, and whether Google has a website on file for them.
// Google Places (New) Text Search + Place Details. Requires
// GOOGLE_PLACES_API_KEY (a billing-enabled Google Cloud project, but
// well within the monthly free credit at this volume: one Text Search
// + one Details call per lead, and this only runs at lead creation,
// not per page view).
//
// Best-effort by design: enrichment failing should never block lead
// creation, so every function here returns null on any error instead
// of throwing, and the caller (api/forge-leads.js) treats null as
// "couldn't enrich this one, move on."

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

export async function fetchBusinessSignals(businessName, location) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !businessName) return null;

  try {
    const query = location ? `${businessName}, ${location}` : businessName;
    const res = await fetch(TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Field mask keeps this on Places API's cheapest ("Pro") SKU
        // tier — rating/review count/website are all in that tier, no
        // need for the pricier Enterprise fields (photos, reviews text).
        'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.formattedAddress',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const place = data.places?.[0];
    if (!place) return null;
    return {
      matchedName: place.displayName?.text || null,
      rating: typeof place.rating === 'number' ? place.rating : null,
      reviewCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
      website: place.websiteUri || null,
      formattedAddress: place.formattedAddress || null,
    };
  } catch (err) {
    console.error('forgePlaces lookup failed:', err.message);
    return null;
  }
}
