export const INDIVIDUAL_WORK_MS=240_000;

export function remainingModelTimeout(context,now=Date.now()) {
  const requested=Number(context.providerTimeoutMs) || 90_000;
  const state=context.reasoningState;
  const remaining=state ? state.budgets.maxElapsedMs-(now-state.startedAt) : requested;
  return Math.max(5_000,Math.min(requested,remaining,240_000));
}
