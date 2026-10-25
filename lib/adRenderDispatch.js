// Starts the "Render worker" GitHub Actions workflow the moment a render job is queued, so renders begin within a minute
// instead of waiting for the schedule. The workflow itself reads the real job from the database; this call carries no job data.
// The token lives only in process.env (NEXUS_RENDER_DISPATCH_TOKEN), is read at call time, and is never logged or put in an error.
// Failure never blocks the job: the scheduled run is the backup.
const REPO = 'jrl6933380-hub/nexus-labs', WORKFLOW = 'render-worker.yml', REF = 'main';

export async function dispatchRenderWorker({ env = process.env, fetchImpl = fetch } = {}) {
  const token = env.NEXUS_RENDER_DISPATCH_TOKEN;
  if (!token) return { dispatched: false, reason: 'NOT_CONFIGURED' };
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'nexus-render-dispatch' },
      body: JSON.stringify({ ref: REF }),
    });
    if (res.status === 204) return { dispatched: true };
    return { dispatched: false, reason: `GITHUB_${res.status}` };
  } catch {
    return { dispatched: false, reason: 'NETWORK' };
  }
}
