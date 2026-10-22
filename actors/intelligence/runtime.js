import { createHash } from 'node:crypto';
import { runIntelligenceBatch, validateIntelligenceInput, INTELLIGENCE_RESULT_EVENT } from '../../lib/intelligenceBatch.js';

// Key-value store keys allow limited characters, so derive a stable key from the requested URL.
export const baselineKey = url => `baseline-${createHash('sha256').update(url).digest('hex').slice(0,40)}`;

export async function runActor(actor, {capture} = {}) {
  const input = await actor.getInput();
  const charging = actor.getChargingManager();
  // Validate first so bad input fails before any storage is opened or any page is fetched.
  const plan = validateIntelligenceInput(input);
  // Baselines live in a named store in the running user's own Apify account, never shared across users.
  const store = plan.remember ? await actor.openKeyValueStore(plan.baselineStoreName) : null;
  const summary = await runIntelligenceBatch(input,{
    ...(capture ? {capture} : {}),
    ...(store ? {
      loadBaseline: async url => store.getValue(baselineKey(url)),
      saveBaseline: async (url,value) => store.setValue(baselineKey(url),value),
    } : {}),
    canPublish: async () => charging.calculateMaxEventChargeCountWithinLimit(INTELLIGENCE_RESULT_EVENT) > 0,
    publish: async (row,{chargeEvent}) => {
      if(chargeEvent) {
        // SDK pushData applies the per-result event and the caller's charge ceiling.
        await actor.pushData(row,chargeEvent);
      } else await actor.pushData(row);
    },
    progress: async ({completed,total}) => actor.setStatusMessage(`Checked ${completed} of ${total} selected pages.`),
  });
  await actor.setValue('SUMMARY',summary);
  await actor.setStatusMessage(summary.stoppedForBudget
    ? 'Stopped at the configured result budget. Available results are saved.'
    : `Finished: ${summary.successful} captures (${summary.changed} changed), ${summary.failed} inspection gaps.`,{isStatusMessageTerminal:true});
  return summary;
}
