import { contractFor, laneFor } from './nexLanes.js';

const CODE_ACTION = /\b(add|build|change|code|create|debug|delete|deploy|edit|fix|implement|migrate|patch|refactor|remove|rename|ship|update|wire)\b/iu;
const CODE_OBJECT = /\b(api|app|branch|bug|component|database|deploy(?:ment)?|endpoint|file|function|github|migration|pr|pull request|repo(?:sitory)?|route|schema|site|test|ui)\b/iu;
const COMPLEXITY_SIGNAL = /\b(architecture|auth(?:entication|orization)?|billing|concurren(?:cy|t)|data loss|distributed|multi[- ](?:agent|model|step)|permission|production|race condition|security|tenant|workflow)\b/iu;
const HIGH_RISK_SIGNAL = /\b(billing|credential|customer data|delete|deploy|financial|live|merge|migration|permission|production|secret|security)\b/iu;
const COUNCIL_SIGNAL = /\b(brain crew|council|multiple models|multi[- ]model|second opinion|specialists?|team of models)\b/iu;
const GATED_ACTION_SIGNAL = /\b(charge|delete (?:the )?repo|deploy it|deploy (?:to )?production|live branch|merge (?:it|the pr|pull request)|refund|rotate (?:a )?credential)\b/iu;
const MULTI_STEP_SIGNAL = /(?:\bthen\b|\bafter that\b|\bfirst\b[\s\S]{0,100}\bthen\b|(?:,|\band\b)[\s\S]{0,80}(?:,|\band\b))/iu;

const TIER_WEIGHT = Object.freeze({ cheap: 0, standard: 1, heavy: 2 });

function normalizeMessage(message) {
  return String(message || '').replace(/\s+/gu, ' ').trim();
}

function explicitLane(toolContext = {}) {
  const requested = String(toolContext.cognitiveLane || '').toLowerCase();
  return requested === 'chat' || requested === 'code' ? requested : null;
}

function chooseLane(message, toolContext) {
  const requested = explicitLane(toolContext);
  if (requested) return { lane: requested, reason: 'explicit_lane' };

  if (CODE_ACTION.test(message) && (CODE_OBJECT.test(message) || message.length >= 80)) {
    return { lane: 'code', reason: 'code_change_intent' };
  }

  return { lane: 'chat', reason: 'conversation_or_analysis' };
}

function scoreComplexity(message, lane, forcedTier, toolContext) {
  let score = lane === 'code' ? 1 : 0;
  const reasons = [];

  if (message.length >= 500) {
    score += 1;
    reasons.push('long_request');
  }
  if (MULTI_STEP_SIGNAL.test(message)) {
    score += 1;
    reasons.push('multi_step');
  }
  if (COMPLEXITY_SIGNAL.test(message)) {
    score += 2;
    reasons.push('complex_domain');
  }
  if (HIGH_RISK_SIGNAL.test(message)) {
    score += 2;
    reasons.push('high_risk_surface');
  }
  if (COUNCIL_SIGNAL.test(message)) {
    score += 3;
    reasons.push('explicit_council');
  }
  if (toolContext.deepThoughtRequested === true) {
    score += 1;
    reasons.push('deep_thought');
  }
  if (forcedTier === 'heavy') {
    score += 1;
    reasons.push('heavy_model_selected');
  }

  return { score, reasons };
}

function evidenceFor(lane, requiresApproval) {
  if (lane === 'chat') return [];
  const evidence = ['source_read', 'non_live_branch', 'targeted_diff', 'relevant_tests'];
  if (requiresApproval) evidence.push('explicit_approval_for_gated_action');
  return evidence;
}

export function planCognitiveRun({ message, forcedTier = null, toolContext = {} } = {}) {
  const normalized = normalizeMessage(message);
  const selected = chooseLane(normalized, toolContext);
  const { score, reasons } = scoreComplexity(normalized, selected.lane, forcedTier, toolContext);
  const risk = HIGH_RISK_SIGNAL.test(normalized) ? 'high' : selected.lane === 'code' ? 'medium' : 'low';
  const requiresApproval = GATED_ACTION_SIGNAL.test(normalized);
  const crewRequested = toolContext.forceCrew === true || COUNCIL_SIGNAL.test(normalized);
  const mode = crewRequested || (selected.lane === 'code' && score >= 4) ? 'crew' : 'direct';
  const lane = laneFor(selected.lane);

  return Object.freeze({
    version: 1,
    lane: lane.id,
    mode,
    risk,
    complexity: score >= 4 ? 'complex' : score >= 2 ? 'moderate' : 'simple',
    score,
    crew: mode === 'crew' ? [...lane.crew] : ['nex'],
    minimumTier: mode === 'crew' ? 'heavy' : lane.id === 'code' ? 'standard' : 'cheap',
    requireEvidence: evidenceFor(lane.id, requiresApproval),
    reasons: [selected.reason, ...reasons],
  });
}

export function resolveCognitiveTier(classifiedTier, forcedTier, plan) {
  if (forcedTier && Object.hasOwn(TIER_WEIGHT, forcedTier)) return forcedTier;
  const classified = Object.hasOwn(TIER_WEIGHT, classifiedTier) ? classifiedTier : 'standard';
  const minimum = Object.hasOwn(TIER_WEIGHT, plan?.minimumTier) ? plan.minimumTier : 'cheap';
  return TIER_WEIGHT[classified] >= TIER_WEIGHT[minimum] ? classified : minimum;
}

export function formatCognitiveDirective(plan) {
  const safePlan = plan || planCognitiveRun({ message: '' });
  return [
    '## Runtime cognitive plan (selected by backend policy)',
    `Lane: ${safePlan.lane}`,
    `Mode: ${safePlan.mode}`,
    `Risk: ${safePlan.risk}`,
    `Complexity: ${safePlan.complexity} (score ${safePlan.score})`,
    `Crew: ${safePlan.crew.join(' -> ')}`,
    `Required evidence before completion: ${safePlan.requireEvidence.join(', ')}`,
    `Routing reasons: ${safePlan.reasons.join(', ')}`,
    '',
    contractFor(safePlan.lane),
  ].join('\n');
}

// Standing policy Nex applies on every turn, regardless of what that
// turn's lane/mode/risk works out to be. These three started as
// candidate skill files (model-routing, context-cache, security-review)
// but a skill only loads when selectNexSkills scores it against the
// message's actual wording -- "wire up Stripe for this client" should
// trigger security review even though nothing in that phrasing contains
// a word a keyword matcher would catch. Correctness-critical guardrails
// like these need to be unconditional, not conditionally triggered, so
// they live here as always-active policy instead of as skill files.
// Static text -- goes in the stable/cached half of the system prompt
// (lib/nexBrain.js's stableSystemText), never the dynamic half, since
// it's identical on every call and belongs with the other cached policy.
export const STANDING_POLICY = [
  '## Model routing (always active, not conditional on message wording)',
  'Select the model tier by the actual difficulty of the task in front of you, not by habit or by what was used last time. Reach for multiple models/specialists only when it genuinely helps -- not as a default posture. On a real failure, escalate rather than silently downgrading capability or quietly retrying the same thing. Respect the configured spending/effort ceilings even under standing build permission; a broad "go ahead" is not authorization to ignore cost controls.',
  '## Context and cache discipline (always active, not conditional on message wording)',
  'Keep stable content (identity, policy, instructions) separate from dynamic per-turn content (live workspace, memories, snapshot, skills) so prompt caching actually functions -- mixing them defeats the cache for both. Enforce context budgets rather than letting unbounded data accumulate into the prompt. Where cache_read_input_tokens/cache_creation_input_tokens are available, check them rather than assuming a caching design is working just because it looks correct on paper.',
  '## Security review (always active, not conditional on message wording)',
  'Before wiring a new tool, integration, or credential path, threat-model it: authorization boundaries, tenant isolation, how secrets are handled, and whether the action is destructive or irreversible. This applies to anything touching billing, credentials, tenant data, or infrastructure -- regardless of whether the request happens to use the word "security" -- since that is exactly the case a keyword-triggered skill would miss.',
].join('\n\n');
