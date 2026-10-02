// Account-scoped project relationships for planning and Nex. Never include credentials.
import { listProjects } from '../roomHistory.js';
import { getProjectBrief, publicProjectBrief } from './projectBrief.js';
import { getStackManifest, recommendStack, STACK_CATALOG } from '../forgeStack.js';

export async function readProjectContext({ ownerUsername, projectId, readProjects = listProjects, readBrief = getProjectBrief, readStack = getStackManifest } = {}) {
  const results = await Promise.allSettled([
    readProjects(ownerUsername),
    readBrief({ ownerUsername, projectId }),
    readBrief({ ownerUsername, projectId, mode: 'addon' }),
    readStack({ ownerUsername, projectId }),
  ]);
  const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
  const project = (value(0) || []).find(item => (item.projectId || item.key) === projectId);
  const stack = value(3);
  const original = value(1);
  const addon = value(2);
  return {
    project: project ? { projectId, label: String(project.mainLabel || project.label || 'Your project').slice(0, 80), latestBuildId: project.latestBuildId, pieces: (project.stackItems || []).map(piece => ({ kind: piece.kind, label: String(piece.label || '').slice(0, 80) })) } : null,
    originalPlan: original ? publicProjectBrief(original) : null,
    addonPlan: addon ? publicProjectBrief(addon) : null,
    features: [...new Set([...(stack?.features || []), ...(original?.answers?.features || [])])],
    connections: stack ? Object.entries(stack.slots || {}).map(([id, slot]) => ({ id, label: STACK_CATALOG[id]?.label || id, provider: slot.provider || null, status: slot.status, required: Boolean(slot.required) })) : [],
    unavailable: results.map((result, index) => result.status === 'rejected' ? ['projects', 'originalPlan', 'addonPlan', 'connections'][index] : null).filter(Boolean),
  };
}

export function connectionsForPlan(context, brief) {
  const features = [...new Set([...(context.features || []), ...(brief.answers?.features || [])])].filter(feature => feature !== 'none');
  const recommendation = recommendStack({ projectType: context.originalPlan?.answers?.project_type, features });
  return recommendation.requiredSlots.map(id => ({
    id, label: STACK_CATALOG[id]?.label || id, purpose: STACK_CATALOG[id]?.purpose || '',
    status: context.connections?.find(slot => slot.id === id)?.status || 'not_checked',
  }));
}

export function approvedAddonInstruction(context) {
  if (!context?.project || context.unavailable?.includes('projects')) throw new Error('Could not confirm the saved project for this addition.');
  const plan = context.addonPlan;
  if (!plan?.progress?.ready || !plan.approved_at) throw new Error('Review and approve the completed add-on plan before building it.');
  return plan.summary.map(item => `- ${item.label}: ${item.value}${item.comment ? ` — ${item.comment}` : ''}`).join('\n');
}
