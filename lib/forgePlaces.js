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

// Bulk business search for lead import ("plumbers in Tulsa, OK") —
// the hand-built, ToS-compliant equivalent of a Maps scraper, using
// the same official API key as fetchBusinessSignals above. Returns
// only results with a phone number, since a lead with no way to call
// it isn't useful here.
export async function searchBusinesses(query, { maxResults = 20 } = {}) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !query) return [];

  try {
    const res = await fetch(TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Adds phone number on top of the basic fetchBusinessSignals
        // set — a bulk import needs a number to actually call, so this
        // pulls in Contact Data, not just the cheaper Pro tier alone.
        'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.formattedAddress,places.nationalPhoneNumber,places.primaryTypeDisplayName',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: Math.min(Math.max(maxResults, 1), 20) }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.places || [])
      .filter((place) => place.nationalPhoneNumber)
      .map((place) => ({
        businessName: place.displayName?.text || null,
        phone: place.nationalPhoneNumber,
        rating: typeof place.rating === 'number' ? place.rating : null,
        reviewCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
        website: place.websiteUri || null,
        location: place.formattedAddress || null,
        category: place.primaryTypeDisplayName?.text || null,
      }));
  } catch (err) {
    console.error('forgePlaces search failed:', err.message);
    return [];
  }
}
