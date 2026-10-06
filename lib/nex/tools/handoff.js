// /lib/nex/tools/handoff.js
// Provider-neutral development handoffs + tunneled pipeline tool schemas.
//
// Note: get_forge_escalation lives here because of its POSITION in the array,
// not its name. Do not relocate it into ./forge.js — that would reorder TOOLS.

export const HANDOFF_TOOLS = [
  {
    name: 'prepare_dev_handoff',
    description: 'Prepare a provider-neutral, copy-ready handoff for a developer or development agent only when Justin explicitly asks to hand work to his dev team. Before calling it, clarify the real goal and inspect the relevant source, logs, or current behavior so the packet contains evidence instead of guesses. The packet identifies scope, constraints, files, acceptance checks, attempted work, and open questions. It never grants approval to edit, merge, deploy, or spend money.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name for the development task.' },
        goal: { type: 'string', description: 'The outcome Justin wants, written so someone outside this chat can understand it.' },
        current_behavior: { type: 'string', description: 'What happens now, including the concrete problem or limitation.' },
        desired_outcome: { type: 'string', description: 'What should happen when the work is finished.' },
        owner: { type: 'string', description: 'Repository owner.' },
        repo: { type: 'string', description: 'Repository name.' },
        branch: { type: 'string', description: 'Current or intended non-live branch, when known.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Relevant repository paths Nex has identified.' },
        evidence: { type: 'array', items: { type: 'string' }, description: 'Observed errors, logs, screenshots, source findings, or reproduced behavior.' },
        attempted: { type: 'array', items: { type: 'string' }, description: 'Work already tried and what happened.' },
        constraints: { type: 'array', items: { type: 'string' }, description: 'Product, safety, design, compatibility, or scope constraints.' },
        acceptance_criteria: { type: 'array', items: { type: 'string' }, description: 'Observable checks that define done.' },
        open_questions: { type: 'array', items: { type: 'string' }, description: 'Unresolved questions the receiving developer should answer.' },
      },
      required: ['goal', 'owner', 'repo'],
    },
  },
  { name:'return_handoff_result',description:'Return a builder or reviewer result and evidence to a Handoff Gateway packet.',input_schema:{type:'object',properties:{handoff_id:{type:'string'},summary:{type:'string'},evidence:{type:'array',items:{type:'string'}}},required:['handoff_id','summary']} },
  { name:'start_tunneled_pipeline',description:'Create the real multi-pipe build flow for a large request: one layout/function lane and one design lane start as separate Board tasks; the reviewer/QA task is locked until both return evidence; only a passing review returns one final package to Nex. This coordinates scoped work only and does not merge or deploy.',input_schema:{type:'object',properties:{goal:{type:'string'},owner:{type:'string'},repo:{type:'string'},branch:{type:'string'},acceptance_criteria:{type:'array',items:{type:'string'}},layout_agent:{type:'string'},design_agent:{type:'string'},reviewer_agent:{type:'string'}},required:['goal','owner','repo']} },
  { name:'submit_pipeline_lane_result',description:'Record one completed layout/function or design lane result with evidence. When both lane results are present, this automatically creates the mandatory reviewer/QA Board task.',input_schema:{type:'object',properties:{pipeline_id:{type:'string'},lane:{type:'string',enum:['layout','design']},summary:{type:'string'},evidence:{type:'array',items:{type:'string'}}},required:['pipeline_id','lane','summary']} },
  { name:'submit_pipeline_review',description:'Record the mandatory reviewer/QA decision. A pass produces the single ready-for-Nex package; needs_changes keeps the pipeline out of ready state and records the required corrections.',input_schema:{type:'object',properties:{pipeline_id:{type:'string'},decision:{type:'string',enum:['pass','needs_changes']},summary:{type:'string'},evidence:{type:'array',items:{type:'string'}},corrections:{type:'array',items:{type:'string'}}},required:['pipeline_id','decision','summary']} },
  { name:'get_tunneled_pipeline',description:'Read one tunneled pipeline run, including its lane tasks, evidence, reviewer decision, and final Nex handoff when ready.',input_schema:{type:'object',properties:{pipeline_id:{type:'string'}},required:['pipeline_id']} },
  { name:'get_forge_escalation',description:'Read the private customer request and current project source for a Nexus Forge Build Team ticket. Source is paged so large projects stay bounded. Use the returned nextOffset until null when the full project is required.',input_schema:{type:'object',properties:{escalation_id:{type:'string'},offset:{type:'number'},max_chars:{type:'number'}},required:['escalation_id']} },
];
