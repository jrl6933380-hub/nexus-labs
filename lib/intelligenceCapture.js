import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import { createHash } from 'node:crypto';

const fail = (message, code = 'CAPTURE_FAILED') => Object.assign(new Error(message), { code });
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b))
      || (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0));
  }
  // Accept native global-unicast IPv6 only; reject mapped, transition and local ranges.
  if (isIP(address) === 6) return /^[23]/i.test(address) && !/^(2001:(0:|db8:)|2002:)/i.test(address);
  return false;
}
export function normalizePublicUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw Object.assign(fail('Enter a full HTTPS page URL.', 'INVALID_URL'),{status:400}); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password
    || !host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid|example)$/i.test(host)
    || (isIP(host) && !publicAddress(host))) throw Object.assign(fail('Use a public HTTPS website without credentials or a custom port.', 'INVALID_URL'),{status:400});
  url.hash = '';
  return url.href;
}
export async function resolvePublicUrl(value, resolver = lookup) {
  const url = new URL(normalizePublicUrl(value));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const records = isIP(host) ? [{address:host, family:isIP(host)}] : await resolver(host, { all: true, verbatim: true });
  if (!records.length || records.some(r => !publicAddress(r.address))) throw fail('This address is not a public website.', 'PRIVATE_ADDRESS');
  return { url, address: records[0] };
}
function requestPage(url, address, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'NexusIntelligence/1.0 (+public-page-research)', Accept: 'text/html,text/plain', 'Accept-Encoding': 'identity' },
      // Pin the checked DNS address; redirects go through validation again.
      lookup: (_host, options, callback) => options?.all
        ? callback(null, [address]) : callback(null, address.address, address.family),
    }, response => {
      const status = response.statusCode;
      if (status >= 300 && status < 400) { response.resume(); resolve({status, location:response.headers.location}); return; }
      if (status !== 200) { response.resume(); reject(fail(`Page returned HTTP ${status}.`, 'HTTP_ERROR')); return; }
      if (!/^(text\/html|text\/plain|application\/xhtml\+xml)/i.test(response.headers['content-type'] || '')) {
        response.resume(); reject(fail('Only HTML and plain-text pages are supported.', 'UNSUPPORTED_CONTENT')); return;
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.resume(); reject(fail('The page returned unsupported compressed content.', 'UNSUPPORTED_CONTENT')); return;
      }
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > 1_000_000) response.destroy(fail('Page exceeds the 1 MB capture limit.', 'PAGE_TOO_LARGE')); else chunks.push(chunk); });
      response.on('end', () => resolve({status, html:Buffer.concat(chunks).toString('utf8')}));
      response.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(fail('Page capture timed out.', 'TIMEOUT')), timeout);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
}
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, value) => {
  const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  if (value[0] !== '#') return named[value.toLowerCase()] ?? match;
  const n = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2),16) : parseInt(value.slice(1),10);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
});
export function extractPage(html) {
  const title = decode((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]*>/g,'')).trim().slice(0,200);
  const clean = html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<(nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<\/(p|div|h[1-6]|li|section|article|tr|main)>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ');
  const lines = decode(clean).split(/\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const text = [...new Set(lines)].join('\n').slice(0,24000);
  if (text.length < 60 || /^(just a moment|access denied|verify you are human|attention required)/i.test(title)
    || /checking (your browser|if the site connection is secure)|enable javascript and cookies to continue|verify you are human/i.test(text)) {
    throw fail('This page needs a browser or presented an access challenge. The previous capture is preserved.', 'BROWSER_REQUIRED');
  }
  return {title, text};
}
export async function capturePublicPage(value, { resolver = lookup, request = requestPage, now = Date.now } = {}) {
  const started = now(); let target = normalizePublicUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const remaining = 12000 - (now() - started);
    if (remaining <= 0) throw fail('Page capture timed out.', 'TIMEOUT');
    let timer;
    const {url,address} = await Promise.race([
      resolvePublicUrl(target,resolver),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('Page address lookup timed out.','TIMEOUT')),remaining);}),
    ]).finally(()=>clearTimeout(timer));
    const networkRemaining=12000-(now()-started);
    if(networkRemaining<=0)throw fail('Page capture timed out.','TIMEOUT');
    const response = await request(url,address,networkRemaining);
    if (response.location) { target = new URL(response.location,url).href; continue; }
    if (response.status >= 300) throw fail('The page returned an invalid redirect.');
    const {title,text} = extractPage(response.html);
    return {url:url.href, title, text, capturedAt:new Date(now()).toISOString(), hash:createHash('sha256').update(text).digest('hex'),
      captureMethod:'public-html', screenshot:null, screenshotStatus:'not_captured'};
  }
  throw fail('Too many redirects.', 'REDIRECT_LIMIT');
}
export function compareCaptures(previous, latest) {
  if (!previous) return {kind:'baseline', added:[], removed:[]};
  if (previous.hash === latest.hash) return {kind:'unchanged', added:[], removed:[]};
  const before = new Set(previous.text.split('\n')), after = new Set(latest.text.split('\n'));
  return {kind:'changed', added:[...after].filter(x=>!before.has(x)).slice(0,8).map(x=>x.slice(0,600)),
    removed:[...before].filter(x=>!after.has(x)).slice(0,8).map(x=>x.slice(0,600))};
}
