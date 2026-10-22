import { createHash } from 'node:crypto';
import { capturePublicPage, compareCaptures, normalizePublicUrl } from './intelligenceCapture.js';

export const INTELLIGENCE_RESULT_EVENT = 'page-result';
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
    hash:createHash('sha256').update(value.text).digest('hex')};
}
export function validateIntelligenceInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be an object.');
  if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > 50) throw new Error('Provide between 1 and 50 page URLs.');
  const urls = [...new Set(input.urls.map(value => {
    if (typeof value !== 'string') throw new Error('Each URL must be a string.');
    return normalizePublicUrl(value);
  }))];
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
      hash:createHash('sha256').update(row.text).digest('hex')});
  }
  return {urls:urls.slice(0,maxPages),previous,includeText:input.includeText !== false,remember:rememberBaselines,baselineStoreName,
    requested:input.urls.length,unique:urls.length,skipped:Math.max(0,urls.length-maxPages)};
}

export function observedAmounts(text) {
  // Observed strings, not inferred plans, effective prices or currency conversions.
  return [...new Set(text.match(/(?:[$€£]\s?\d[\d,.]*(?:\s?\/(?:mo(?:nth)?|yr|year))?|\b(?:USD|EUR|GBP)\s?\d[\d,.]*)/g) || [])].slice(0,30);
}

export async function runIntelligenceBatch(input, {
  capture = capturePublicPage,
  publish = async () => {},
  canPublish = async () => true,
  progress = async () => {},
  now = () => new Date().toISOString(),
  loadBaseline = async () => null,
  saveBaseline = async () => {},
  sleep = sleepMs,
} = {}) {
  const plan = validateIntelligenceInput(input);
  const summary = {schemaVersion:1,requested:plan.requested,unique:plan.unique,skipped:plan.skipped,attempted:0,successful:0,failed:0,emitted:0,stoppedForBudget:false,
    changed:0,unchanged:0,baselines:0,storedBaselinesUsed:0,changedUrls:[]};
  for (const requestedUrl of plan.urls) {
    // Check remaining result budget before doing more network work.
    if (!await canPublish()) { summary.stoppedForBudget = true; break; }
    summary.attempted++;
    await progress({completed:summary.attempted-1,total:plan.urls.length});
    let current;
    // Explicit caller baselines win. Otherwise use this user's own saved baseline from the last successful run.
    let previous = plan.previous.get(requestedUrl), fromStore = false;
    if (!previous && plan.remember) { previous = storedBaseline(await loadBaseline(requestedUrl)) || undefined; fromStore = Boolean(previous); }
    try { current = await captureWithRetry(capture, requestedUrl, sleep); }
    catch (error) {
      const row = {schemaVersion:1,requestedUrl,url:requestedUrl,status:'failed',checkedAt:now(),capturedAt:null,title:null,
        comparison:'unavailable',previousCapturedAt:previous?.capturedAt || null,added:[],removed:[],observedAmounts:[],
        screenshotUrl:null,error:{code:error.code || 'CAPTURE_FAILED',message:error.code ? error.message : 'The page could not be captured.'}};
      // Error records are delivered without a charge event. Previous state is never overwritten.
      await publish(row,{chargeEvent:null});summary.failed++;summary.emitted++;continue;
    }
    const change = compareCaptures(previous,current);
    const row = {schemaVersion:1,requestedUrl,url:current.url,status:'captured',checkedAt:now(),capturedAt:current.capturedAt,title:current.title,
      contentHash:current.hash,captureMethod:current.captureMethod || 'public-html',comparison:change.kind,previousCapturedAt:previous?.capturedAt || null,
      added:change.added,removed:change.removed,observedAmounts:observedAmounts(current.text),screenshotUrl:null,error:null,
      ...(plan.includeText ? {text:current.text} : {})};
    // Storage/billing errors must fail the run, not become misleading capture failures.
    const result = await publish(row,{chargeEvent:INTELLIGENCE_RESULT_EVENT});
    if(result?.emitted === false){summary.stoppedForBudget=true;break;}
    summary.successful++;summary.emitted++;
    if (fromStore) summary.storedBaselinesUsed++;
    if (change.kind === 'changed') { summary.changed++; summary.changedUrls.push(current.url); }
    else if (change.kind === 'unchanged') summary.unchanged++; else summary.baselines++;
    // Only a successful, delivered capture replaces the saved baseline. Failures never overwrite it.
    if (plan.remember) await saveBaseline(requestedUrl,{text:current.text,title:current.title,url:current.url,capturedAt:current.capturedAt});
  }
  await progress({completed:summary.attempted,total:plan.urls.length});
  return summary;
}
