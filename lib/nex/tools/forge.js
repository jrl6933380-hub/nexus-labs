// /lib/nex/tools/forge.js
// Forge customer, escalation, and account tool schemas, split out of
// lib/nexBrain.js. Pure move: these objects are byte-for-byte what TOOLS
// already contained, and are spread back into TOOLS at their original
// position.
//
// `create_forge_account` and `delete_forge_account` touch real accounts and
// `delete_forge_escalation` is irreversible. Those behaviors are enforced in
// the dispatch logic and in lib/forgeAccounts.js / lib/roomEscalation.js, not
// in this schema file — moving the schema here does not and cannot change it.

export const FORGE_TOOLS = [
  {
    name: 'list_forge_customers',
    description: 'Read-only rollup of every real Nexus Forge account: plan, signup date, usage against their plan, and live Stripe billing status (or null if there is no subscription on record). This is the same data Mr. Lopez sees in the Forge Ops dashboard. Never modifies anything — billing changes still go through propose_stripe_action.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_forge_escalations',
    description: "List Forge Build Team escalations (tester/customer requests that needed more than the instant builder) with their current status, customer/project id, and linked pipeline id. Use this to see what's actually in flight across Forge right now instead of needing a specific escalation id handed to you. Pass status to filter (e.g. 'queueing', 'lanes_running', 'reviewing', 'ready_for_nex'); omit to see everything. Follow up with get_forge_escalation for the full request text, or get_tunneled_pipeline for lane-by-lane build detail.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Optional status filter, e.g. 'queueing', 'lanes_running', 'reviewing', 'ready_for_nex'." },
      },
      required: [],
    },
  },
  {
    name: 'delete_forge_escalation',
    description: "Permanently delete a Forge escalation record. Use when an escalation is dead or stale — an old test, a duplicate, or something Mr. Lopez has said not to pursue — so it stops resurfacing in list_forge_escalations as if it were live work waiting to be built. Deleting board tasks alone does NOT do this; the record lives separately and will keep reappearing. Irreversible, and it does not touch any branches or PRs already created. Confirm with Mr. Lopez before deleting anything that might be a real customer's request.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The escalation id, e.g. forge-1789437860221-7bpvwp.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_forge_account',
    description: "Create a real Room/Forge account and hand back its password. Use this when Mr. Lopez asks for a worker account, a manager account, or a test/customer account. kind: 'worker' (seats forge_worker — can work leads in Forge Field), 'manager' (forge_manager — can also manage), or 'customer' (no Forge role, an ordinary account, which is what a test account should normally be). Omit password and a strong one is generated. Optionally set plan ('free', 'hosted', 'growth', 'unlimited') — leave it off for a realistic free-tier test account, since a paid plan skips the publish gate and changes metering. The password is shown ONCE and cannot be read back, so give it to Mr. Lopez in your reply. This cannot make anyone an operator; operator status comes from an environment variable and is deliberately out of reach here. Creating an account is real and billable-adjacent — do it when asked, not speculatively, and never reuse an existing username (it will be refused rather than overwrite them).",
    input_schema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: '3-32 characters: letters, numbers, underscore, or dash.' },
        kind: { type: 'string', enum: ['worker', 'manager', 'customer'], description: "Defaults to 'customer'." },
        password: { type: 'string', description: 'Optional. At least 8 characters. Omit to have one generated.' },
        plan: { type: 'string', enum: ['free', 'hosted', 'growth', 'unlimited'], description: 'Optional billing plan. Omit for the default free tier.' },
      },
      required: ['username'],
    },
  },
  {
    name: 'find_forge_account',
    description: "Look up ANY Room/Forge account by username — free, paid, worker, manager, test. Use this to answer 'does this account exist', to check someone's plan or Forge role, or to confirm an account you just created is really there. IMPORTANT: do NOT use list_forge_customers for this. That tool deliberately covers only paying accounts (paid plan or Stripe history) and returns nothing for ordinary free accounts, so an empty result there is not evidence an account is missing. Returns no credentials — passwords cannot be read back, only reset.",
    input_schema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'The username to look up. Case-insensitive.' },
      },
      required: ['username'],
    },
  },
  {
    name: 'list_forge_accounts',
    description: "List every Room/Forge account, optionally filtered. Unlike list_forge_customers (paying accounts only), this covers free and test accounts too, so it is the right tool for 'who has a worker account', 'what test accounts exist', or auditing who is on which plan. Filter by forgeRole ('forge_worker' or 'forge_manager') or by plan ('free', 'hosted', 'growth', 'unlimited'). Returns no credentials.",
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['forge_worker', 'forge_manager'], description: 'Optional: only accounts seated in this Forge role.' },
        plan: { type: 'string', enum: ['free', 'hosted', 'growth', 'unlimited'], description: 'Optional: only accounts on this plan.' },
      },
      required: [],
    },
  },
  {
    name: 'delete_forge_account',
    description: "Permanently delete a Room/Forge account: the user record, its Stripe reverse-index entry, and every live session (so the account cannot stay signed in on an old cookie). Irreversible — there is no undo and no backup. Use it for orphaned or finished test accounts, or a worker who has left. Confirm with Mr. Lopez before deleting anything that might belong to a real person or customer; when in doubt, look it up with find_forge_account first and say what you found. Two refusals you cannot override: operator accounts (deleting the record would strip their login while leaving their env-derived privileges intact), and accounts with billing on record unless you pass acknowledge_billing — deleting does NOT cancel a Stripe subscription, so they would keep being charged with no way to sign in. Cancel the subscription first.",
    input_schema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'The account to delete.' },
        acknowledge_billing: { type: 'boolean', description: 'Set true ONLY when the account has billing on record and its subscription has already been cancelled. Leave unset otherwise.' },
      },
      required: ['username'],
    },
  },
];

export default FORGE_TOOLS;
