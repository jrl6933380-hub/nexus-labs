// lib/forgeStripe.js
// Stripe for the Forge caller program: client checkout links, reading
// paid invoices, Connect onboarding for callers, and commission
// transfers. Raw fetch to the Stripe REST API, same no-dependency
// pattern as api/checkout.js.

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SITE_URL = process.env.SITE_URL || 'https://nexus-labs-sigma.vercel.app';

// Live prices on the "Nexus OS" Stripe account (created 2026-09-25).
// Env overrides let a test-mode deployment point at test prices.
export const FORGE_PRICE_IDS = Object.freeze({
  basic: process.env.FORGE_PRICE_BASIC || 'price_1UJTt7Dh5Di7LYi3m3hWJ6cX',
  standard: process.env.FORGE_PRICE_STANDARD || 'price_1UJTtBDh5Di7LYi3z7vWsNJa',
  plus: process.env.FORGE_PRICE_PLUS || 'price_1UJTtFDh5Di7LYi3sHjKpRug',
});

export function encodeForm(obj, prefix, params = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => (typeof v === 'object' ? encodeForm(v, `${name}[${i}]`, params) : params.append(`${name}[${i}]`, String(v))));
    } else if (typeof value === 'object') {
      encodeForm(value, name, params);
    } else {
      params.append(name, String(value));
    }
  }
  return params;
}

async function stripe(method, path, body, { idempotencyKey } = {}) {
  if (!STRIPE_SECRET_KEY) throw new Error('Billing is not configured (STRIPE_SECRET_KEY missing).');
  const headers = { Authorization: `Bearer ${STRIPE_SECRET_KEY}` };
  let url = `https://api.stripe.com/v1/${path}`;
  let payload;
  if (method === 'GET') {
    if (body) url += `?${encodeForm(body)}`;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    payload = encodeForm(body || {});
  }
  const res = await fetch(url, { method, headers, body: payload });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${method} ${path} failed (${res.status})`);
  return data;
}

// ---------- client checkout ----------
// Subscription checkout the caller texts to the business owner. The
// forge_client_id rides on the subscription itself, so every future
// invoice identifies its client without a lookup table.
export async function createClientCheckout(client) {
  const price = FORGE_PRICE_IDS[client.tier];
  if (!price) throw new Error(`No Stripe price for tier ${client.tier}`);
  const session = await stripe('POST', 'checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: client.id,
    metadata: { kind: 'forge_client', forge_client_id: client.id },
    subscription_data: {
      description: `Forge Site: ${client.business_name}`,
      metadata: { kind: 'forge_client', forge_client_id: client.id },
    },
    success_url: `${SITE_URL}/forge-welcome.html`,
    cancel_url: `${SITE_URL}/forge-welcome.html?cancelled=1`,
  }, { idempotencyKey: `forge-checkout-${client.id}-${client.tier}-${new Date().toISOString().slice(0, 13)}` });
  return session.url;
}

// ---------- invoices ----------
// Handles both the pre-2025 invoice shape and the 2025+ ("basil")
// shape, where subscription info moved under invoice.parent and the
// charge moved to invoice payments.
export function readInvoice(invoice) {
  const subDetails = invoice.parent?.subscription_details || invoice.subscription_details || {};
  return {
    invoiceId: invoice.id,
    subscriptionId: invoice.subscription || subDetails.subscription || null,
    customerId: invoice.customer || null,
    forgeClientId: subDetails.metadata?.forge_client_id || null,
    amountPaidCents: invoice.amount_paid || 0,
    isFirst: invoice.billing_reason === 'subscription_create',
    chargeId: typeof invoice.charge === 'string' ? invoice.charge : (invoice.charge?.id || null),
  };
}

// The charge that funded an invoice. Commission transfers reference it
// (source_transaction) so they can go out before funds settle.
export async function getInvoiceChargeId(invoice) {
  const direct = readInvoice(invoice).chargeId;
  if (direct) return direct;
  try {
    const list = await stripe('GET', 'invoice_payments', { invoice: invoice.id, 'expand[]': 'data.payment.payment_intent' });
    for (const row of list.data || []) {
      const pi = row.payment?.payment_intent;
      if (pi && typeof pi === 'object' && pi.latest_charge) return typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge.id;
      if (row.payment?.charge) return typeof row.payment.charge === 'string' ? row.payment.charge : row.payment.charge.id;
    }
  } catch (err) {
    console.error('forgeStripe: invoice payment lookup failed', err.message);
  }
  return null;
}

// ---------- Connect (caller payouts) ----------
export async function createCallerConnectAccount(caller) {
  const account = await stripe('POST', 'accounts', {
    type: 'express',
    country: 'US',
    capabilities: { transfers: { requested: true } },
    business_type: 'individual',
    metadata: { forge_caller_id: caller.id, forge_username: caller.forge_username },
  }, { idempotencyKey: `forge-connect-${caller.id}` });
  return account.id;
}

export async function createConnectOnboardingLink(accountId) {
  const link = await stripe('POST', 'account_links', {
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${SITE_URL}/forge-caller.html?payouts=retry`,
    return_url: `${SITE_URL}/forge-caller.html?payouts=done`,
  });
  return link.url;
}

export async function getConnectAccount(accountId) {
  return stripe('GET', `accounts/${encodeURIComponent(accountId)}`);
}

// Pays one commission ledger row. Idempotent on the ledger row id, so a
// retry can never send the same commission twice.
export async function transferCommission({ eventId, amountCents, destination, chargeId, clientId }) {
  const transfer = await stripe('POST', 'transfers', {
    amount: amountCents,
    currency: 'usd',
    destination,
    source_transaction: chargeId || undefined,
    transfer_group: clientId ? `forge_client_${clientId}` : undefined,
    metadata: { forge_commission_event_id: eventId, forge_client_id: clientId || '' },
  }, { idempotencyKey: `forge-commission-${eventId}` });
  return transfer.id;
}
