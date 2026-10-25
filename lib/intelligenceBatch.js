import { createHash } from 'node:crypto';
import { capturePublicPage, compareCaptures, normalizePublicUrl } from './intelligenceCapture.js';
import { normalizeCompetitor } from './intelligenceDiscover.js';

export const INTELLIGENCE_RESULT_EVENT = 'page-result';
export const BROWSER_RESULT_EVENT = 'browser-page-result';
export const RENDER_MODES = ['auto', 'html', 'browser'];
export const DEFAULT_BASELINE_STORE = 'nexus-intelligence-baselines';
const sleepMs = ms => new Promise(resolve => setTimeout(resolve, ms));
// One retry for transient failures only. Failed pages are never charged, so retrying costs the user nothing.
export const isTransient = error => error?.code === 'TIMEOUT' || (error?.code === 'HTTP_ERROR' && /HTTP (429|5\d\d)\b/.test(error.message || ''));
export async function captureWithRetry(capture, url, sleep = sleepMs) {
  try { return await capture(url); }
  catch (error) { if (!isTransient(error)) throw error; await sleep(1500); return capture(url); }
}
export function storedBaseline(value) {
  // Stored state is untrusted: re-derive the hash and drop anything malformed instead of making false diffs.
  if (!value || typeof value !== 'object' || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 24000
    || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))) return null;
  return {text:value.text,title:String(value.title || '').slice(0,200),url:String(value.url || ''),capturedAt:value.capturedAt,
    method:value.method === 'browser' ? 'browser' : 'public-html',hash:createHash('sha256').update(value.text).digest('hex')};
}
export function validateIntelligenceInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be an object.');
  const rawUrls = input.urls ?? [], rawCompetitors = input.competitors ?? [];
  if (!Array.isArray(rawUrls) || rawUrls.length > 50) throw new Error('Provide at most 50 page URLs.');
  if (!Array.isArray(rawCompetitors) || rawCompetitors.length > 20) throw new Error('Provide at most 20 competitor websites.');
  if (rawUrls.length + rawCompetitors.length < 1) throw new Error('Provide page URLs, competitor websites, or both.');
  const urls = [...new Set(rawUrls.map(value => {
    if (typeof value !== 'string') throw new Error('Each URL must be a string.');
    return normalizePublicUrl(value);
  }))];
  const competitors = [...new Set(rawCompetitors.map(normalizeCompetitor))];
  const pagesPerCompetitor = input.pagesPerCompetitor ?? 3;
  if (!Number.isInteger(pagesPerCompetitor) || pagesPerCompetitor < 1 || pagesPerCompetitor > 5) throw new Error('pagesPerCompetitor must be between 1 and 5.');
  const renderMode = input.renderMode ?? 'auto';
  if (!RENDER_MODES.includes(renderMode)) throw new Error('renderMode must be auto, html or browser.');
  const maxPages = input.maxPages ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) throw new Error('maxPages must be between 1 and 50.');
  if (input.includeText !== undefined && typeof input.includeText !== 'boolean') throw new Error('includeText must be true or false.');
  const rememberBaselines = input.rememberBaselines ?? true;
  if (typeof rememberBaselines !== 'boolean') throw new Error('rememberBaselines must be true or false.');
  const baselineStoreName = input.baselineStoreName ?? DEFAULT_BASELINE_STORE;
  if (typeof baselineStoreName !== 'string' || baselineStoreName.length < 3 || baselineStoreName.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(baselineStoreName)) {
    throw new Error('baselineStoreName must be 3-63 lowercase letters, numbers and single hyphens.');
  }
  const previousResults = input.previousResults ?? [];
  if (!Array.isArray(previousResults) || previousResults.length > 50) throw new Error('Provide at most 50 previous results.');
  const previous = new Map();
  for (const row of previousResults) {
    if (!row || row.status !== 'captured' || typeof row.text !== 'string' || row.text.length > 24000 || !row.text.trim()) {
      throw new Error('Every previous result must be a successful captured row with its full text (maximum 24,000 characters).');
    }
    // A redirect may change the final URL. Match the caller's original requested URL.
    const url = normalizePublicUrl(row.requestedUrl || row.url);
    if (previous.has(url)) throw new Error('Previous results contain duplicate requested URLs.');
    if (typeof row.capturedAt !== 'string' || !Number.isFinite(Date.parse(row.capturedAt))) throw new Error('Previous results require a valid capturedAt timestamp.');
    previous.set(url, {text:row.text,title:String(row.title || '').slice(0,200),url:normalizePublicUrl(row.url),capturedAt:row.capturedAt,
      method:row.captureMethod === 'browser' ? 'browser' : 'public-html',hash:createHash('sha256').update(row.text).digest('hex')});
  }
  return {urls:urls.slice(0,maxPages),competitors,pagesPerCompetitor,renderMode,maxPages,previous,includeText:input.includeText !== false,remember:rememberBaselines,baselineStoreName,
    requested:rawUrls.length,unique:urls.length,skipped:Math.max(0,urls.length-maxPages)};
}

export function observedAmounts(text) {
  // Observed strings, not inferred plans, effective prices or currency conversions.
  return [...new Set(text.match(/(?:[$€£]\d[\d,]*(?:\.\d{1,2})?(?:\s?\/\s?(?:mo(?:nth)?|yr|year|user|seat))?|\b(?:USD|EUR|GBP)\s?\d[\d,]*(?:\.\d{1,2})?)/g) || [])].slice(0,30);
}

// Plain-language label for what kind of page this is, from its address only.
export function pageType(url) {
  let path = '';
  try { path = new URL(url).pathname.toLowerCase(); } catch { return 'other'; }
  if (/pric|plan|package|rates?\b|membership|subscri/.test(path)) return 'pricing';
  if (/service|solution|offer/.test(path)) return 'services';
  if (/feature|compare/.test(path)) return 'features';
  return 'other';
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export function describeChange(kind, {priceChanges, counts, previousCapturedAt, baselineReset}) {
  if (kind === 'baseline') return baselineReset
    ? 'This page was read a different way than last time, so a fresh baseline was saved.'
    : 'First capture saved as your baseline. Changes show up from the next run.';
  if (kind === 'unchanged') return `No changes since ${String(previousCapturedAt || '').slice(0,10) || 'the last run'}.`;
  const parts = [];
  const price = [priceChanges.removed.length ? `no longer shows ${priceChanges.removed.join(', ')}` : '', priceChanges.added.length ? `now shows ${priceChanges.added.join(', ')}` : ''].filter(Boolean);
  if (price.length) parts.push(`Prices: ${price.join('; ')}.`);
  parts.push(`${plural(counts.added,'passage')} added, ${counts.removed} removed.`);
  return parts.join(' ');
}
const lineDiffCounts = (before, after) => {
  const a = new Set(before.split('\n')), b = new Set(after.split('\n'));
  return {added:[...b].filter(x => !a.has(x)).length, removed:[...a].filter(x => !b.has(x)).length};
};

export async function runIntelligenceBatch(input, {
  capture = capturePublicPage,
  publish = async () => {},
  canPublish = async () => true,
  progress = async () => {},
  now = () => new Date().toISOString(),
  describe = () => ({}),
  loadBaseline = async () => null,
  saveBaseline = async () => {},
  sleep = sleepMs,
} = {}) {
  const plan = validateIntelligenceInput(input);
  const summary = {schemaVersion:1,requested:plan.requested,unique:plan.unique,skipped:plan.skipped,attempted:0,successful:0,failed:0,emitted:0,stoppedForBudget:false,
    changed:0,unchanged:0,baselines:0,storedBaselinesUsed:0,changedUrls:[],changes:[],failures:[],byCompetitor:{}};
  for (const requestedUrl of plan.urls) {
    // Check remaining result budget before doing more network work.
    if (!await canPublish(plan.renderMode === 'browser' ? BROWSER_RESULT_EVENT : INTELLIGENCE_RESULT_EVENT)) { summary.stoppedForBudget = true; break; }
    summary.attempted++;
    await progress({completed:summary.attempted-1,total:plan.urls.length});
    let current;
    // Explicit caller baselines win. Otherwise use this user's own saved baseline from the last successful run.
    let previous = plan.previous.get(requestedUrl), fromStore = false;
    if (!previous && plan.remember) { previous = storedBaseline(await loadBaseline(requestedUrl)) || undefined; fromStore = Boolean(previous); }
    try { current = await captureWithRetry(capture, requestedUrl, sleep); }
    catch (error) {
      const failure = {code:error.code || 'CAPTURE_FAILED',message:error.code ? error.message : 'The page could not be captured.'};
      const row = {schemaVersion:1,...describe(requestedUrl),requestedUrl,url:requestedUrl,status:'failed',checkedAt:now(),capturedAt:null,title:null,
        comparison:'unavailable',previousCapturedAt:previous?.capturedAt || null,added:[],removed:[],observedAmounts:[],
        screenshotUrl:null,error:failure,pageType:pageType(requestedUrl),
        changeSummary:`Could not read this page: ${failure.message}${previous ? ' Your saved copy is kept.' : ''}`};
      summary.failures.push({url:requestedUrl,code:failure.code});
      // Error records are delivered without a charge event. Previous state is never overwritten.
      await publish(row,{chargeEvent:null});summary.failed++;summary.emitted++;continue;
    }
    const method = current.captureMethod || 'public-html';
    // Text from the HTML and the browser path differ, so comparing across methods would invent changes. Start a fresh baseline instead.
    let baselineReset = false;
    if (previous && (previous.method || 'public-html') !== method) { previous = undefined; fromStore = false; baselineReset = true; }
    const change = compareCaptures(previous,current);
    const amounts = observedAmounts(current.text), type = pageType(current.url);
    // Full counts and price movement, because the added/removed lists above are capped for readability.
    const counts = change.kind === 'changed' ? lineDiffCounts(previous.text,current.text) : {added:0,removed:0};
    const before = change.kind === 'changed' ? observedAmounts(previous.text) : [];
    const priceChanges = change.kind === 'changed'
      ? {added:amounts.filter(x => !before.includes(x)),removed:before.filter(x => !amounts.includes(x))} : {added:[],removed:[]};
    const changeSummary = describeChange(change.kind,{priceChanges,counts,previousCapturedAt:previous?.capturedAt,baselineReset});
    const row = {schemaVersion:1,...describe(requestedUrl),requestedUrl,url:current.url,status:'captured',checkedAt:now(),capturedAt:current.capturedAt,title:current.title,
      contentHash:current.hash,captureMethod:method,...(baselineReset ? {baselineReset:true} : {}),comparison:change.kind,previousCapturedAt:previous?.capturedAt || null,
      added:change.added,removed:change.removed,observedAmounts:amounts,screenshotUrl:null,error:null,
      pageType:type,changeSummary,priceChanges,changeCounts:counts,
      ...(plan.includeText ? {text:current.text} : {})};
    // Storage/billing errors must fail the run, not become misleading capture failures.
    const result = await publish(row,{chargeEvent:method === 'browser' ? BROWSER_RESULT_EVENT : INTELLIGENCE_RESULT_EVENT});
    if(result?.emitted === false){summary.stoppedForBudget=true;break;}
    summary.successful++;summary.emitted++;
    if (fromStore) summary.storedBaselinesUsed++;
    const host = row.competitor || new URL(current.url).hostname.replace(/^www\./,'');
    const entry = summary.byCompetitor[host] ??= {pages:0,changed:0};
    entry.pages++;
    if (change.kind === 'changed') { summary.changed++; summary.changedUrls.push(current.url); entry.changed++; summary.changes.push({competitor:host,url:current.url,pageType:type,changeSummary}); }
    else if (change.kind === 'unchanged') summary.unchanged++; else summary.baselines++;
    // Only a successful, delivered capture replaces the saved baseline. Failures never overwrite it.
    if (plan.remember) await saveBaseline(requestedUrl,{text:current.text,title:current.title,url:current.url,capturedAt:current.capturedAt,method});
  }
  await progress({completed:summary.attempted,total:plan.urls.length});
  return summary;
}
