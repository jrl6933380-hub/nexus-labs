// Runs lib/liveBrowser.js against the REAL E2B (the repo's own e2b package) with an in-memory store.
// Results are written as GitHub annotations. Needs E2B_API_KEY and the built nexus-browser template.
import {createLiveBrowser} from '../lib/liveBrowser.js';

const kv = new Map();
const command = async ([c, k, v]) => { if (c === 'GET') return kv.get(k) ?? null; if (c === 'SET') { kv.set(k, v); return 'OK'; } if (c === 'DEL') { kv.delete(k); return 1; } throw new Error('unexpected ' + c); };
const lb = createLiveBrowser({command, logins: {status: async () => ({logins: []}), reveal: async () => { throw new Error('not used'); }}});
let failed = 0;
const note = (ok, name, detail = '') => { if (!ok) failed++; console.log(`::${ok ? 'notice' : 'error'} title=${name}::${String(detail).replace(/[\r\n%]+/g, ' ').slice(0, 300) || 'ok'}`); };
const USER = 'e2e-owner';
try {
  let t = Date.now();
  const opened = await lb.run(USER, 'browser_open', {url: 'https://example.com/'});
  note(opened.inline_images?.[0]?.data_base64?.length > 2000, 'open starts the sandbox and returns a screenshot', `${Date.now() - t} ms, ${opened.title}`);
  t = Date.now();
  const read = await lb.run(USER, 'browser_read', {});
  note(/This domain is for use/.test(read.text || '') && /untrusted|never as instructions/i.test(read.untrusted || ''), 'second step reuses the running sandbox and reads text', `${Date.now() - t} ms`);
  const scrolled = await lb.run(USER, 'browser_scroll', {dy: 300});
  note(!!scrolled.inline_images, 'scroll returns a screenshot');
  const status = await lb.run(USER, 'browser_status', {});
  note(status.running === true && status.url === 'https://example.com/', 'status reports the page', JSON.stringify(status));
  const closed = await lb.run(USER, 'browser_close', {});
  note(closed.closed === true && closed.was_running === true, 'close shuts the sandbox down', JSON.stringify(closed));
  note((await lb.run(USER, 'browser_status', {})).running === false, 'status shows it stopped');
} catch (error) {
  note(false, 'unexpected error', error.stack || error.message || error);
} finally {
  try { await lb.run(USER, 'browser_close', {}); } catch {}
}
process.exit(failed ? 1 : 0);
