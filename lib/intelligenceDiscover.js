import { normalizePublicUrl } from './intelligenceCapture.js';

// Find the pages worth watching on a competitor's site (pricing, plans, services) from just its domain.
// Only public, same-site links are considered. Nothing is guessed silently: guessed paths are only kept if they load.

const POSITIVE = {
  pricing: 10, prices: 9, price: 8, plans: 9, plan: 6, packages: 8, package: 6, rates: 7, services: 7, service: 5,
  offers: 5, offer: 4, membership: 5, memberships: 5, features: 4, solutions: 3, compare: 3, subscribe: 3, quote: 3,
};
const NEGATIVE = new Set(['blog', 'news', 'press', 'careers', 'jobs', 'login', 'signin', 'sign-in', 'signup', 'sign-up', 'register',
  'privacy', 'terms', 'cookie', 'cookies', 'legal', 'support', 'help', 'contact', 'about', 'docs', 'api', 'status', 'cart',
  'checkout', 'account', 'tag', 'category', 'author', 'wp-content', 'wp-json', 'feed', 'sitemap', 'cdn-cgi', 'unsubscribe']);
const FILE_EXTENSION = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mov|css|js|xml|json|ico|woff2?)$/i;
const GUESSES = ['/pricing', '/plans', '/services'];

const words = value => String(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export function normalizeCompetitor(value) {
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error('Each competitor must be a website address such as example.com.'), { code: 'INVALID_URL' });
  const text = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let host;
  try { host = new URL(withScheme).hostname; } catch { throw Object.assign(new Error('Enter a website address such as example.com.'), { code: 'INVALID_URL' }); }
  return new URL(normalizePublicUrl(`https://${host}/`)).origin;
}

const bareHost = hostname => hostname.toLowerCase().replace(/^www\./, '');
export const sameSite = (origin, hostname) => {
  const base = bareHost(new URL(origin).hostname), host = bareHost(hostname);
  return host === base || host.endsWith(`.${base}`);
};

// Higher score means more likely to be a pricing, plans or services page. Zero or below means ignore.
export function scoreLink(href, text = '') {
  let url;
  try { url = new URL(href); } catch { return 0; }
  if (url.protocol !== 'https:' || FILE_EXTENSION.test(url.pathname)) return 0;
  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) return 0;
  const pathWords = segments.flatMap(words);
  if (pathWords.some(word => NEGATIVE.has(word)) || segments.some(segment => NEGATIVE.has(segment.toLowerCase()))) return 0;
  let score = 0;
  for (const word of pathWords) score += POSITIVE[word] ?? 0;
  for (const word of words(text).slice(0, 6)) score += (POSITIVE[word] ?? 0) / 2;
  if (score <= 0) return 0;
  return score - Math.max(0, segments.length - 2);
}

const key = url => { const parsed = new URL(url); return `${bareHost(parsed.hostname)}${parsed.pathname.replace(/\/+$/, '')}`; };
export function rankCandidates(origin, candidates) {
  const best = new Map();
  for (const { href, text, source } of candidates) {
    let url;
    try { url = new URL(href, origin); } catch { continue; }
    if (!sameSite(origin, url.hostname)) continue;
    url.hash = ''; url.search = '';
    const score = scoreLink(url.href, text);
    if (score <= 0) continue;
    const id = key(url.href), current = best.get(id);
    if (!current || score > current.score) best.set(id, { url: url.href, score, source });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.url.length - b.url.length);
}

export function anchorsFromHtml(html) {
  const found = [];
  for (const match of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    found.push({ href: (match[1] ?? match[2] ?? '').trim(), text: match[3].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) });
    if (found.length >= 600) break;
  }
  return found;
}
export function locsFromSitemap(xml) {
  if (/<sitemapindex\b/i.test(xml)) return [];
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].slice(0, 3000).map(match => match[1]);
}

// fetchHtml(url, {xml}) -> {url, html}; links(url) -> {links} (optional browser fallback for script-built navigation).
export async function discoverPages(origin, { fetchHtml, links, perSite = 3 } = {}) {
  const candidates = [];
  let homeUrl = `${origin}/`;
  try {
    const home = await fetchHtml(homeUrl);
    homeUrl = home.url;
    for (const anchor of anchorsFromHtml(home.html)) candidates.push({ ...anchor, href: new URL(anchor.href, home.url).href, source: 'link' });
  } catch { /* A homepage that cannot be read still leaves sitemap and probes. */ }
  let ranked = rankCandidates(origin, candidates);
  if (!ranked.length && links) {
    try { const rendered = await links(homeUrl); ranked = rankCandidates(origin, rendered.links.map(link => ({ ...link, source: 'link' }))); } catch { /* fall through */ }
  }
  try {
    const sitemap = await fetchHtml(`${origin}/sitemap.xml`, { xml: true });
    ranked = rankCandidates(origin, [...ranked.map(({ url, source }) => ({ href: url, text: '', source })),
      ...locsFromSitemap(sitemap.html).map(href => ({ href, text: '', source: 'sitemap' }))]);
  } catch { /* No readable sitemap is normal. */ }
  const pages = ranked.slice(0, perSite);
  for (const path of GUESSES) {
    if (pages.length >= perSite || ranked.length) break;
    try { const probe = await fetchHtml(`${origin}${path}`); if (new URL(probe.url).pathname.replace(/\/+$/, '')) pages.push({ url: probe.url, score: 1, source: 'guess' }); } catch { /* Missing guesses are dropped, not reported as failures. */ }
  }
  return pages;
}
