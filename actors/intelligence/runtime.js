import { runIntelligenceBatch, INTELLIGENCE_RESULT_EVENT } from '../../lib/intelligenceBatch.js';

export async function runActor(actor, {capture} = {}) {
  const input = await actor.getInput();
  const charging = actor.getChargingManager();
  const summary = await runIntelligenceBatch(input,{
    ...(capture ? {capture} : {}),
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
    : `Finished: ${summary.successful} captures, ${summary.failed} inspection gaps.`,{isStatusMessageTerminal:true});
  return summary;
}
