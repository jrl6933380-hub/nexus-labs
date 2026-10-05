// lib/forgeCustomers.js
// Customer-ops view for the operator dashboard: every paying (or
// once-paying) Room account, its plan, usage against that plan, and
// its live Stripe subscription status. This is the "whole control
// center" surface — read side only; changes go through the existing
// approved billing actions in lib/stripeAdmin.js.
//
// Stripe calls are one-per-customer with a subscription on record.
// Fine at today's scale (this mirrors how the rest of this codebase
// handles Stripe — see stripeAdmin.js's own comment about narrow,
// approved actions); revisit if the customer list gets large.

import { listUsers, PLANS } from './roomAuth.js';
import { roomMeter } from './roomMetering.js';
import { getCustomerBillingStatus } from './stripeAdmin.js';

export async function listForgeCustomers() {
  const users = await listUsers();
  // A "customer" for this view is anyone on a paid plan or with a Stripe
  // customer id on record — not free-tier signups with no billing history.
  const customers = users.filter((u) => u.plan !== PLANS.FREE || u.stripeCustomerId);

  return Promise.all(
    customers.map(async (u) => {
      const [usage, billing] = await Promise.all([
        roomMeter.getUsageSummary(u.username).catch(() => null),
        u.stripeCustomerId ? getCustomerBillingStatus(u.stripeCustomerId).catch(() => null) : Promise.resolve(null),
      ]);
      return {
        username: u.username,
        email: u.email,
        plan: u.plan,
        createdAt: u.createdAt,
        stripeCustomerId: u.stripeCustomerId,
        usage: usage
          ? { unlimited: Boolean(usage.unlimited), remaining: usage.remaining ?? null, limit: usage.limit ?? null, consumed: usage.consumed ?? null }
          : null,
        billing, // null = no subscription on record; otherwise { status, cancelAtPeriodEnd, currentPeriodEnd, latestInvoiceStatus }
      };
    })
  );
}
