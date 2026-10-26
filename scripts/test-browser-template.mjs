// Proves the "nexus-browser" E2B template really runs Chromium: starts a sandbox from it, starts the live browser agent,
// opens real pages, reads text, takes a screenshot, checks the token guard, then kills the sandbox.
// Run from the "Test browser template" workflow (needs E2B_API_KEY, e2b v2, Node 22).
import {Sandbox} from 'e2b';
import {randomBytes} from 'node:crypto';

const TOKEN = randomBytes(16).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
// Also written as GitHub annotations, which can be read through the API without downloading the log.
const clean = s => String(s).replace(/[\r\n%]+/g, ' ').slice(0, 400);
const check = (name, ok, detail = '') => {
  results.push({name, ok});
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  console.log(`::${ok ? 'notice' : 'error'} title=${clean(name).replace(/[:,]/g, ' ')}::${clean(detail) || (ok ? 'ok' : 'failed')}`);
};

let sandbox;
try {
  sandbox = await Sandbox.create('nexus-browser', {timeoutMs: 5 * 60_000});
  check('starts a sandbox from the nexus-browser template', true);
  await sandbox.commands.run('cd /opt/nexus-browser && PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node live-browser-agent.mjs', {background: true, envs: {LB_TOKEN: TOKEN}, timeoutMs: 0});
  const base = 'https://' + sandbox.getHost(9333);
  let healthy = false;
  for (let i = 0; i < 30 && !healthy; i++) { try { healthy = (await fetch(base + '/health')).ok; } catch {} if (!healthy) await sleep(1000); }
  check('agent starts and answers /health', healthy);
  if (!healthy) throw new Error('Agent never became healthy.');

  const act = async body => (await fetch(base + '/act', {method: 'POST', headers: {'content-type': 'application/json', 'x-lb-token': TOKEN}, body: JSON.stringify(body)})).json();
  check('rejects a request without the token', (await fetch(base + '/act', {method: 'POST', body: '{}'})).status === 403);

  const opened = await act({action: 'open', url: 'https://example.com/'});
  check('opens example.com in Chromium', opened.ok === true && /example/i.test(opened.title || ''), opened.error || opened.title);
  check('returns a real screenshot', typeof opened.shot === 'string' && opened.shot.length > 2000, `${(opened.shot || '').length} base64 chars`);
  const text = await act({action: 'text'});
  check('reads page text', /Example Domain/.test(text.text || ''), text.error || '');
  check('refuses http:// pages', (await act({action: 'open', url: 'http://example.com/'})).ok === false);

  const tiktok = await act({action: 'open', url: 'https://www.tiktok.com/login'});
  check('reaches the TikTok login page', tiktok.ok === true, tiktok.error || `${tiktok.url} | ${tiktok.title}`);
} catch (error) {
  check('no unexpected error', false, String(error.message || error));
} finally {
  await sandbox?.kill().catch(() => {});
}
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
