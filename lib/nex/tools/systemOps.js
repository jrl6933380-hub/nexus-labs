// /lib/nex/tools/systemOps.js
// Slice 12 of the nexBrain.js TOOLS-array extraction: the small,
// non-contiguous inline system/ops schemas — system status,
// merge+deploy status, and sandbox/reference/board-attach reads.
// Pure move — schemas only, verbatim from nexBrain.js, no behavior
// change. Dispatch logic stays in nexBrain.js; these files only hold
// the tool schema declarations. Split into three exported groups
// (rather than one) because each sits at a different point in the
// original TOOLS array, separated by VERCEL_TOOLS/STRIPE_TOOLS/
// GITHUB_WRITE_TOOLS spreads — spreading them back in at those exact
// same three positions preserves the original array order exactly,
// the same discipline documented in vercel.js for check_deployment_status.

export const SYSTEM_STATUS_TOOLS = [
  {
    name: 'get_system_status',
    description: "Get a live, read-only snapshot of what's actually going on across the system right now: board hygiene (stale/duplicate/mismatched tasks), open PR health (two open PRs editing the same file — the kind of collision that's easy to miss by hand — plus any PR stacked on another branch instead of main), and open Crash Feed issues. Use this whenever Mr. Lopez asks what's going on, what needs attention, or before starting new work that might collide with something already in flight. Purely informational — never mutates anything.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

export const MERGE_DEPLOY_TOOLS = [
  {
    name: 'merge_pull_request',
    description: 'Propose merging one specific GitHub pull request. Merging changes the live/default branch, so this ALWAYS enters the approval queue and never executes until Mr. Lopez explicitly approves this exact proposal in chat, SMS, or the dashboard.',
    input_schema: { type:'object', properties:{ owner:{type:'string'}, repo:{type:'string'}, pull_number:{type:'number'}, merge_method:{type:'string',enum:['merge','squash','rebase']}, commit_title:{type:'string'}, commit_message:{type:'string'}, description:{type:'string'} }, required:['owner','repo','pull_number'] },
  },
  {
    name: 'check_deployment_status',
    description: 'Resolve a GitHub repository to its linked Vercel project and return the latest real deployment state. Read-only.',
    input_schema: { type:'object', properties:{ owner:{type:'string'}, repo:{type:'string'}, target:{type:'string'} }, required:['owner','repo'] },
  },
];

export const SANDBOX_REF_TOOLS = [
  {
    name: 'test_code',
    description: 'Run one JavaScript or Python snippet in a fresh isolated E2B sandbox. The sandbox is destroyed after execution.',
    input_schema: { type:'object', properties:{ language:{type:'string',enum:['javascript','python']}, code:{type:'string'}, timeoutMs:{type:'number'} }, required:['language','code'] },
  },
  {
    name: 'get_reference_link',
    description: 'Look up a generic, non-secret dashboard or documentation URL for builder setup. Omit topic to list available links.',
    input_schema: { type:'object', properties:{ topic:{type:'string'} } },
  },
  {
    name: 'attach_task_result',
    description: 'Attach a redacted result or artifact summary to an existing Agent Board task without marking it complete.',
    input_schema: { type:'object', properties:{ id:{type:'string'}, result:{type:'string'} }, required:['id','result'] },
  },
];
