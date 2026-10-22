import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { finishExtraction, normalizePublicUrl, resolvePublicUrl } from './intelligenceCapture.js';

// Browser rendering for pages whose content only appears after JavaScript runs.
// Playwright is imported lazily so HTML-only runs never load a browser.
const NAVIGATION_MS = 20000, SETTLE_MS = 4000, TOTAL_MS = 35000;
const USER_AGENT = 'NexusIntelligence/1.0 (+public-page-research)';
const fail = (message, code = 'CAPTURE_FAILED') => Object.assign(new Error(message), { code });

// Every network request the page makes (scripts, XHR, redirects) must target a public HTTPS host.
// Limit: the browser resolves DNS itself, so a hostile DNS server could still rebind after this check.
// The Actor runs in the user's own isolated container, which bounds that risk; the plain-HTML path pins addresses instead.
export function createRouteGuard({ resolver = lookup } = {}) {
  const decisions = new Map();
  return async function allowed(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return false; }
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return true;
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) return false;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!decisions.has(host)) {
      decisions.set(host, resolvePublicUrl(`https://${host}/`, resolver).then(() => true, () => false));
    }
    return decisions.get(host);
  };
}

// Runs inside the page. Hides chrome the HTML extractor also drops, then reads what a visitor would see.
export async function extractRenderedPage(page) {
  return page.evaluate(() => {
    document.querySelectorAll('script,style,noscript,svg,template,nav,footer,header').forEach(node => { node.style.display = 'none'; });
    const raw = document.body ? document.body.innerText || '' : '';
    return { title: document.title || '', lines: raw.split(/\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean) };
  });
}
export async function extractRenderedLinks(page) {
  return page.evaluate(() => [...document.querySelectorAll('a[href]')].slice(0, 600)
    .map(a => ({ href: a.href, text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) })));
}

async function defaultLaunch() {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

export function createBrowserRenderer({ launch = defaultLaunch, resolver = lookup, now = Date.now, fulfill } = {}) {
  let browser;
  const guard = createRouteGuard({ resolver });
  const ensureBrowser = async () => { browser ??= await launch(); return browser; };

  async function withPage(value, work) {
    const target = normalizePublicUrl(value);
    await resolvePublicUrl(target, resolver);
    const context = await (await ensureBrowser()).newContext({
      userAgent: USER_AGENT, locale: 'en-US', viewport: { width: 1366, height: 900 }, serviceWorkers: 'block', acceptDownloads: false,
    });
    let timer;
    try {
      const page = await context.newPage();
      await page.route('**/*', async route => {
        const request = route.request();
        if (['image', 'media', 'font'].includes(request.resourceType()) || !(await guard(request.url()))) return route.abort('blockedbyclient');
        // Test hook: serve a fixture instead of the network. Never set in production.
        const fixture = fulfill ? await fulfill(request.url()) : undefined;
        if (fixture) return route.fulfill({ status: fixture.status ?? 200, contentType: fixture.contentType ?? 'text/html; charset=utf-8', body: fixture.body });
        return route.continue();
      });
      const job = (async () => {
        const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_MS });
        if (response && response.status() >= 400) throw fail(`Page returned HTTP ${response.status()}.`, 'HTTP_ERROR');
        await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => {});
        const finalUrl = new URL(page.url());
        if (!await guard(finalUrl.href)) throw fail('This address is not a public website.', 'PRIVATE_ADDRESS');
        finalUrl.hash = '';
        return work(page, finalUrl.href);
      })();
      job.catch(() => {});
      return await Promise.race([
        job,
        new Promise((_, reject) => { timer = setTimeout(() => reject(fail('Page capture timed out.', 'TIMEOUT')), TOTAL_MS); }),
      ]);
    } catch (error) {
      if (error?.code) throw error;
      if (error?.name === 'TimeoutError') throw fail('Page capture timed out.', 'TIMEOUT');
      throw fail('The page could not be rendered.', 'CAPTURE_FAILED');
    } finally {
      clearTimeout(timer);
      await context.close().catch(() => {});
    }
  }

  return {
    async render(value) {
      return withPage(value, async (page, url) => {
        const extracted = await extractRenderedPage(page);
        const { title, text } = finishExtraction(String(extracted.title).trim().slice(0, 200), extracted.lines);
        return { url, title, text, capturedAt: new Date(now()).toISOString(), hash: createHash('sha256').update(text).digest('hex'),
          captureMethod: 'browser', screenshot: null, screenshotStatus: 'not_captured' };
      });
    },
    async links(value) {
      return withPage(value, async (page, url) => ({ url, links: await extractRenderedLinks(page) }));
    },
    async close() { const current = browser; browser = undefined; if (current) await current.close().catch(() => {}); },
  };
}
