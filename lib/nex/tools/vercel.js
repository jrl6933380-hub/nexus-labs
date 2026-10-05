// /lib/nex/tools/vercel.js
// Vercel deployment tool schemas, split out of lib/nexBrain.js.
// Pure move: these objects are byte-for-byte what TOOLS already contained,
// and are spread back into TOOLS at their original position.
//
// Scope note: `check_deployment_status` is Vercel-adjacent but is NOT here.
// In TOOLS it sits after `merge_pull_request`, so moving it would reorder
// the array. Left in place deliberately.

export const VERCEL_TOOLS = [
  {
    name: 'list_vercel_projects',
    description: 'List Vercel projects visible to Nex, including project ids and linked GitHub repositories. Read-only. Use this before listing deployments when the project id is unknown.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum projects to return, 1–100. Defaults to 50.' },
      },
    },
  },
  {
    name: 'list_vercel_deployments',
    description: 'List deployments for a Vercel project with live status, environment, Git branch, and commit SHA. Read-only. Use this to verify what actually deployed instead of treating a GitHub merge as proof that production is healthy.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Vercel project id. Use list_vercel_projects to discover it.' },
        limit: { type: 'number', description: 'Maximum deployments to return, 1–100. Defaults to 20.' },
        target: { type: 'string', description: 'Optional deployment target, such as production or preview.' },
        state: { type: 'string', description: 'Optional state filter, such as READY, ERROR, or BUILDING.' },
        branch: { type: 'string', description: 'Optional Git branch filter.' },
        sha: { type: 'string', description: 'Optional Git commit SHA filter.' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_vercel_build_logs',
    description: 'Fetch build logs for one Vercel deployment by deployment id or URL. Read-only. Defaults to the newest 100 events, where build failures normally appear; set errors_only to narrow the result.',
    input_schema: {
      type: 'object',
      properties: {
        deployment_id: { type: 'string', description: 'Vercel deployment id or hostname.' },
        build_id: { type: 'string', description: 'Optional build id for multi-build deployments.' },
        direction: { type: 'string', enum: ['backward', 'forward'], description: 'backward returns newest events first; forward returns earliest first.' },
        limit: { type: 'number', description: 'Maximum log events, 1–500. Defaults to 100.' },
        errors_only: { type: 'boolean', description: 'Only return error, stderr, fatal, exit, or HTTP-error events.' },
      },
      required: ['deployment_id'],
    },
  },
];
