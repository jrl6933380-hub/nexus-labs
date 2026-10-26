// Runs INSIDE an E2B sandbox (never on Vercel). One persistent Chromium, driven over a small token-protected HTTP API.
// The Nexus server (lib/liveBrowser.js, next PR step) starts this, sends actions, and saves/restores the signed-in state.
// Passwords arrive only via fill_credentials from the server's login vault; they are never echoed back or logged.
// NOTE: Chromium needs roughly 2 GB RAM. The default 512 MB E2B sandbox runs out of memory (V8 CodeRange OOM).
import http from 'node:http';
import {chromium} from 'playwright';

const PORT = Number(process.env.LB_PORT || 9333);
const TOKEN = process.env.LB_TOKEN || '';
const PROFILE = process.env.LB_PROFILE || '/tmp/lb-profile';
const VIEW = {width: 1280, height: 720};
let ctx, page, queue = Promise.resolve();

async function ensure() {
  if (ctx) return;
  ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true, viewport: VIEW, locale: 'en-US', acceptDownloads: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  page = ctx.pages()[0] || await ctx.newPage();
}
const settle = () => page.waitForLoadState('networkidle', {timeout: 3000}).catch(() => {});
async function snap(extra = {}) {
  const shot = (await page.screenshot({type: 'jpeg', quality: 60})).toString('base64');
  return {ok: true, url: page.url(), title: await page.title().catch(() => ''), shot, view: VIEW, ...extra};
}
const num = (v, name) => { if (!Number.isFinite(v)) throw new Error(name + ' must be a number.'); return v; };

const ACTIONS = {
  async open({url}) {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('Only https:// pages can be opened.');
    await page.goto(u.href, {waitUntil: 'domcontentloaded', timeout: 30000});
    await settle();
    return snap();
  },
  async click({x, y}) { await page.mouse.click(num(x, 'x'), num(y, 'y')); await settle(); return snap(); },
  async type({text}) { if (typeof text !== 'string' || text.length > 2000) throw new Error('text must be under 2000 characters.'); await page.keyboard.type(text, {delay: 25}); return snap(); },
  async press({key}) { if (typeof key !== 'string' || key.length > 40) throw new Error('key is required.'); await page.keyboard.press(key); await settle(); return snap(); },
  async scroll({dy = 600}) { await page.mouse.wheel(0, Math.max(-3000, Math.min(3000, num(dy, 'dy')))); await page.waitForTimeout(300); return snap(); },
  async screenshot() { return snap(); },
  async text() { const text = await page.evaluate(() => document.body ? document.body.innerText : ''); return {ok: true, url: page.url(), title: await page.title().catch(() => ''), text: text.slice(0, 20000)}; },
  async get_state() { return {ok: true, state: await ctx.storageState()}; },
  async load_state({state}) { if (state?.cookies?.length) await ctx.addCookies(state.cookies); return snap(); },
  // Types a saved login into the visible sign-in form. The response never contains the values.
  async fill_credentials({username, password}) {
    const pw = page.locator('input[type="password"]:visible').first();
    if (!await pw.count()) throw new Error('No password box is visible. Open the sign-in page first.');
    const user = page.locator('input[type="email"]:visible, input[type="text"]:visible, input[name*="user" i]:visible, input[name*="email" i]:visible').first();
    if (username && await user.count()) await user.fill(String(username));
    await pw.fill(String(password || ''));
    return snap({filled: true});
  },
};

const server = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, {ok: true});
  if (req.method !== 'POST' || req.url !== '/act' || !TOKEN || req.headers['x-lb-token'] !== TOKEN) return send(403, {ok: false, error: 'Forbidden.'});
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 4e6) req.destroy(); });
  req.on('end', () => {
    // One action at a time so clicks never overlap.
    queue = queue.then(async () => {
      try {
        const {action, ...input} = JSON.parse(raw || '{}');
        if (!ACTIONS[action]) return send(400, {ok: false, error: 'Unknown action.'});
        await ensure();
        send(200, await ACTIONS[action](input));
      } catch (error) { send(200, {ok: false, error: String(error.message || error).slice(0, 300)}); }
    });
  });
});
server.listen(PORT, '0.0.0.0', () => console.log('live-browser-agent ready on ' + PORT));
process.on('SIGTERM', async () => { await ctx?.close().catch(() => {}); process.exit(0); });
