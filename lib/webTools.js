// lib/webTools.js
// Real web search + page fetch for Nex — the general-purpose research
// tools flagged as a capability gap (see test/nex-capability-gaps
// and the discussion that led here: hand-building the one Apify tool
// that had an official equivalent, same principle applied to search).
//
// webSearch uses Google's official Programmable Search Engine (Custom
// Search JSON API) — same family of API as lib/forgePlaces.js, same
// billing-enabled-but-free-credit-covers-it tradeoff. Requires
// GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID (a Programmable
// Search Engine configured to search the whole web, not one site).
//
// webFetch is just a plain HTTP GET + regex-based HTML-to-text strip —
// no new npm dependency, consistent with how the rest of this repo
// avoids adding libraries for something this simple. Best-effort: it
// won't handle JS-rendered pages or anything behind a login wall.

const SEARCH_URL = 'https://www.googleapis.com/customsearch/v1';
const FETCH_TEXT_CAP = 8000;

export async function webSearch(query, { num = 5 } = {}) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
  if (!apiKey || !engineId) {
    throw new Error('Web search is not configured (missing GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_ENGINE_ID).');
  }
  if (typeof query !== 'string' || !query.trim()) throw new Error('query is required.');

  const clampedNum = Math.min(Math.max(Number(num) || 5, 1), 10);
  const url = `${SEARCH_URL}?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(engineId)}&num=${clampedNum}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Search request failed (${res.status}).`);

  return (data.items || []).map((item) => ({
    title: item.title || null,
    url: item.link || null,
    snippet: item.snippet || null,
  }));
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function webFetch(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('A valid http(s) url is required.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'NexusForge-Nex/1.0' } });
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}.`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error(`Unsupported content type: ${contentType || 'unknown'}.`);
    }
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const text = stripHtml(html).slice(0, FETCH_TEXT_CAP);
    return {
      url,
      title: titleMatch ? stripHtml(titleMatch[1]) : null,
      text,
      truncated: stripHtml(html).length > FETCH_TEXT_CAP,
    };
  } finally {
    clearTimeout(timer);
  }
}
