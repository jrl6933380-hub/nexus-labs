const SOURCE_TOOLS = new Set(['read_repo_file', 'search_repo_code']);
const WRITE_TOOLS = new Set(['create_repo_file', 'update_repo_file', 'patch_repo_file', 'delete_repo_file', 'commit_repo_files']);
const TEST_TOOLS = new Set(['run_sandbox', 'test_code']);
const PR_REQUIREMENTS = Object.freeze(['source_read', 'non_live_branch', 'targeted_diff', 'relevant_tests']);

function successful(result) {
  return result && result.is_error !== true;
}

function writeExecuted(result) {
  return successful(result) && !/(?:only\s+PROPOSED|queued|not yet executed)/iu.test(String(result.content || ''));
}

function verificationPassed(result) {
  if (!successful(result)) return false;
  const exits = [...String(result.content || '').matchAll(/"exitCode"\s*:\s*(-?\d+)/gu)]
    .map((match) => Number(match[1]));
  return exits.length > 0 && exits.every((code) => code === 0);
}

function diffPassed(result) {
  if (!successful(result)) return false;
  try {
    const parsed = JSON.parse(String(result.content || ''));
    return !Array.isArray(parsed.catastrophic_diffs) || parsed.catastrophic_diffs.length === 0;
  } catch {
    return false;
  }
}

export function createEvidenceTracker(plan = {}) {
  const evidence = new Set();
  const events = [];

  function record(block, result) {
    const tool = String(block?.name || 'unknown');
    const ok = successful(result);
    const event = { tool, ok };

    if (ok && SOURCE_TOOLS.has(tool)) evidence.add('source_read');
    if (ok && tool === 'create_branch') evidence.add('non_live_branch');
    if (WRITE_TOOLS.has(tool) && writeExecuted(result)) {
      evidence.add('write_succeeded');
      if (/not the live branch|safely on branch/iu.test(String(result.content || ''))) evidence.add('non_live_branch');
      event.target = block.input.path || null;
      event.branch = block.input.branch || null;
    }
    if (tool === 'inspect_branch_diff' && diffPassed(result)) evidence.add('targeted_diff');
    if (TEST_TOOLS.has(tool) && verificationPassed(result)) evidence.add('relevant_tests');
    if (ok && tool === 'approve_pending_action') evidence.add('explicit_approval_for_gated_action');
    if (ok && tool === 'create_pull_request') evidence.add('pull_request_opened');

    events.push(event);
    return receipt();
  }

  function missing(requirements = plan.requireEvidence || []) {
    return requirements.filter((item) => !evidence.has(item));
  }

  function authorize(tool) {
    if (tool !== 'create_pull_request') return { allowed: true, missing: [] };
    const absent = missing(PR_REQUIREMENTS);
    return {
      allowed: absent.length === 0,
      missing: absent,
      reason: absent.length ? `PR blocked until evidence exists: ${absent.join(', ')}` : null,
    };
  }

  function receipt() {
    const required = Array.isArray(plan.requireEvidence) ? [...plan.requireEvidence] : [];
    const absent = missing(required);
    return Object.freeze({
      version: 1,
      lane: plan.lane || 'chat',
      status: required.length === 0 ? 'not_required' : absent.length === 0 ? 'verified' : 'incomplete',
      required,
      satisfied: required.filter((item) => evidence.has(item)),
      missing: absent,
      observed: [...evidence],
      events: events.map((event) => ({ ...event })),
    });
  }

  return Object.freeze({ authorize, record, receipt });
}

export { PR_REQUIREMENTS };
