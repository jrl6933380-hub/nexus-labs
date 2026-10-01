import { PLANS } from './roomAuth.js';

export function workbenchProjectAllowance(plan, operator = false) {
  if (operator) return { limit: 10, planName: 'Plus' };
  if (plan === PLANS.HOSTED) return { limit: 3, planName: 'Pro' };
  if (plan === PLANS.GROWTH || plan === PLANS.UNLIMITED) return { limit: 10, planName: 'Plus' };
  return { limit: 0, planName: 'Free' };
}
