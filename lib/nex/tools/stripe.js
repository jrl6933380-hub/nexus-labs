// /lib/nex/tools/stripe.js
// Stripe billing tool schemas, split out of lib/nexBrain.js.
// Pure move: these objects are byte-for-byte what TOOLS already contained,
// and are spread back into TOOLS at their original position.
//
// `propose_stripe_action` is a financial mutation and ALWAYS queues for
// Mr. Lopez's approval. That gate lives in the dispatch logic and the
// approval queue, not in this schema file — moving the schema here does
// not and cannot change it.

export const STRIPE_TOOLS = [
  {
    name: 'get_stripe_object',
    description: 'Read a bounded, redacted operational summary for one Stripe customer, subscription, payment intent, or refund. Read-only; payment-method details are never returned.',
    input_schema: {
      type: 'object',
      properties: {
        object_type: { type: 'string', enum: ['customer', 'subscription', 'payment_intent', 'refund'] },
        id: { type: 'string', description: 'Stripe object id with the matching cus_, sub_, pi_, or re_ prefix.' },
      },
      required: ['object_type', 'id'],
    },
  },
  {
    name: 'propose_stripe_action',
    description: 'Propose one financial/account-entitlement mutation. This ALWAYS enters the approval queue and never executes until Mr. Lopez explicitly approves the exact item. Supported actions: refund a payment, cancel a subscription, set a Nexus user plan, or grant bonus credits.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['refund_payment', 'cancel_subscription', 'set_user_plan', 'grant_bonus_credits'] },
        payment_intent: { type: 'string' },
        amount_cents: { type: 'integer' },
        subscription_id: { type: 'string' },
        username: { type: 'string' },
        plan: { type: 'string', enum: ['free', 'hosted', 'growth', 'unlimited'] },
        credits: { type: 'integer' },
        reason: { type: 'string', description: 'Plain-English reason shown in the approval queue.' },
      },
      required: ['action', 'reason'],
    },
  },
];
