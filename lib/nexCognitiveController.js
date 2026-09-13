import { contractFor, laneFor } from './nexLanes.js';

const CODE_ACTION = /\b(add|build|change|code|create|debug|delete|deploy|edit|fix|implement|migrate|patch|refactor|remove|rename|ship|update|wire)\b/iu;
const CODE_OBJECT = /\b(api|app|branch|bug|component|database|deploy(?:ment)?|endpoint|file|function|github|migration|pr|pull request|repo(?:sitory)?|route|schema|site|test|ui)\b/iu;
const COMPLEXITY_SIGNAL = /\b(architecture|auth(?:entication|orization)?|billing|concurren(?:cy|t)|data loss|distributed|multi[- ](?:agent|model|step)|permission|production|race condition|security|tenant|workflow)\b/iu;
const HIGH_RISK_SIGNAL = /\b(billing|credential|customer data|delete|deploy|financial|live|merge|migration|permission|production|secret|security)\b/iu;
const COUNCIL_SIGNAL = /\b(brain crew|council|multiple models|multi[- ]model|second opinion|specialists?|team of models)\b/iu;
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

function evidenceFor(lane, risk) {
  if (lane === 'chat') return ['grounded_sources_for_specific_claims'];
  const evidence = ['source_read', 'non_live_branch', 'targeted_diff', 'relevant_tests'];
  if (risk === 'high') evidence.push('explicit_approval_for_gated_action');
  return evidence;
}

export function planCognitiveRun({ message, forcedTier = null, toolContext = {} } = {}) {
  const normalized = normalizeMessage(message);
  const selected = chooseLane(normalized, toolContext);
  const { score, reasons } = scoreComplexity(normalized, selected.lane, forcedTier, toolContext);
  const risk = HIGH_RISK_SIGNAL.test(normalized) ? 'high' : selected.lane === 'code' ? 'medium' : 'low';
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
    requireEvidence: evidenceFor(lane.id, risk),
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
