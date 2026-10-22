import { createHash } from 'node:crypto';
import { runIntelligenceBatch, validateIntelligenceInput, INTELLIGENCE_RESULT_EVENT, BROWSER_RESULT_EVENT } from '../../lib/intelligenceBatch.js';
import { capturePublicPage, fetchPublicHtml } from '../../lib/intelligenceCapture.js';
import { createBrowserRenderer } from '../../lib/intelligenceBrowser.js';
import { discoverPages } from '../../lib/intelligenceDiscover.js';

// Key-value store keys allow limited characters, so derive a stable key from the requested URL.
export const baselineKey = url => `baseline-${createHash('sha256').update(url).digest('hex').slice(0,40)}`;

export async function runActor(actor, {capture, renderer: injectedRenderer, fetchHtml = fetchPublicHtml} = {}) {
  const input = await actor.getInput();
  const charging = actor.getChargingManager();
  // Validate first so bad input fails before any storage is opened or any page is fetched.
  const plan = validateIntelligenceInput(input);
  // Baselines live in a named store in the running user's own Apify account, never shared across users.
  const store = plan.remember ? await actor.openKeyValueStore(plan.baselineStoreName) : null;
  const canAfford = async event => charging.calculateMaxEventChargeCountWithinLimit(event) > 0;
  const renderer = plan.renderMode === 'html' ? null : (injectedRenderer || createBrowserRenderer());
  const meta = new Map(), gaps = [];
  try {
    // Turn competitor websites into the exact pages to watch. Explicit URLs always come first.
    const urls = [...plan.urls];
    for (const origin of plan.competitors) {
      await actor.setStatusMessage(`Finding pricing and plan pages on ${new URL(origin).hostname}.`);
      const pages = await discoverPages(origin, {
        fetchHtml,
        links: renderer && plan.renderMode !== 'html' && await canAfford(BROWSER_RESULT_EVENT) ? url => renderer.links(url) : undefined,
        perSite: plan.pagesPerCompetitor,
      });
      if (!pages.length) { gaps.push(origin); continue; }
      for (const page of pages) {
        if (urls.length >= plan.maxPages) break;
        if (urls.includes(page.url)) continue;
        urls.push(page.url);
        meta.set(page.url, {competitor: new URL(origin).hostname, discoveredFrom: page.source});
      }
    }
    const htmlCapture = capture || capturePublicPage;
    const smartCapture = async url => {
      if (plan.renderMode === 'browser') return renderer.render(url);
      try { return await htmlCapture(url); }
      catch (error) {
        // Thin pages and access challenges are the signal that the content is built by JavaScript.
        if (plan.renderMode === 'auto' && error.code === 'BROWSER_REQUIRED' && await canAfford(BROWSER_RESULT_EVENT)) return renderer.render(url);
        throw error;
      }
    };
    // Competitors with nothing found are reported as free coverage gaps, never silently dropped.
    for (const origin of gaps) {
      await actor.pushData({schemaVersion:1,competitor:new URL(origin).hostname,requestedUrl:`${origin}/`,url:`${origin}/`,status:'failed',checkedAt:new Date().toISOString(),
        capturedAt:null,title:null,comparison:'unavailable',previousCapturedAt:null,added:[],removed:[],observedAmounts:[],screenshotUrl:null,
        error:{code:'NO_PAGES_FOUND',message:'No pricing, plans or services page was found. Add the page address in "Competitor page URLs".'}});
    }
    const summary = await runIntelligenceBatch({...input, urls, competitors: plan.competitors},{
      capture: smartCapture,
      describe: url => meta.get(url) || {},
      ...(store ? {
        loadBaseline: async url => store.getValue(baselineKey(url)),
        saveBaseline: async (url,value) => store.setValue(baselineKey(url),value),
      } : {}),
      canPublish: canAfford,
      publish: async (row,{chargeEvent}) => {
        if(chargeEvent) {
          // SDK pushData applies the per-result event and the caller's charge ceiling.
          await actor.pushData(row,chargeEvent);
        } else await actor.pushData(row);
      },
      progress: async ({completed,total}) => actor.setStatusMessage(`Checked ${completed} of ${total} selected pages.`),
    });
    summary.competitorsWithoutPages = gaps.map(origin => new URL(origin).hostname);
    await actor.setValue('SUMMARY',summary);
    await actor.setStatusMessage(summary.stoppedForBudget
      ? 'Stopped at the configured result budget. Available results are saved.'
      : `Finished: ${summary.successful} captures (${summary.changed} changed), ${summary.failed + gaps.length} inspection gaps.`,{isStatusMessageTerminal:true});
    return summary;
  } finally {
    if (renderer && !injectedRenderer) await renderer.close();
  }
}
