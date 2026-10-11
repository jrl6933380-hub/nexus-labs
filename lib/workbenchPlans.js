import { PLANS } from './roomAuth.js';

export function workbenchProjectAllowance(plan, operator = false) {
  if (operator) return { limit: null, planName: 'Owner' };
  if (plan === PLANS.HOSTED) return { limit: 3, planName: 'Pro' };
  if (plan === PLANS.GROWTH || plan === PLANS.UNLIMITED) return { limit: 6, planName: 'Plus' };
  return { limit: 1, planName: 'Free' };
}
