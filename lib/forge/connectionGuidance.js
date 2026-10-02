import { STACK_CATALOG, recommendStack } from '../forgeStack.js';

const SERVICES = {
  brain: ['Nex', 'Nex helps plan, build, and maintain the pieces of this project.', 'brain'],
  auth: ['Sign-in', 'Sign-in gives customers accounts and keeps private areas separate from public pages.', 'accounts'],
  database: ['Database', 'A database saves information so it survives refreshes and can be shared across devices.', 'database'],
  storage: ['File Storage', 'File storage keeps uploaded images, documents, and other files outside the page itself.', 'uploads'],
  deployment: ['Hosting', 'Hosting publishes the complete project on one public link.', 'deployment'],
  payments: ['Payments', 'Payments handle real checkout or subscriptions and report whether a payment succeeded.', 'payments'],
  email: ['Email', 'Email sends confirmations, receipts, and notifications through a verified sender.', 'email'],
  domain: ['Domain', 'A domain gives the live site a custom address that visitors can remember.', 'domain'],
  observability: ['Monitoring', 'Monitoring reports errors and service health after the project is running.', 'monitoring'],
};

export function describeProjectConnections(context, manifest, actions = {}) {
  const projectName = context?.project?.label || manifest.project_name || 'this project';
  const features = new Set(context?.features || manifest.features || []);
  const booking = features.has('bookings') || context?.originalPlan?.answers?.project_type === 'booking';
  const commerce = features.has('payments') || features.has('store') || context?.originalPlan?.answers?.project_type === 'store';
  const dataUse = booking ? 'save reservations, available times, and booking changes' : commerce ? 'save product and order information' : 'save form submissions, customer records, or other information your addition needs';
  const uses = {
    brain: `For “${projectName}”, Nex can scope an addition and show how it fits the existing site.`,
    auth: `For “${projectName}”, this could protect ${booking ? 'customer bookings or a staff schedule' : commerce ? 'customer orders or the store dashboard' : 'a customer portal, private dashboard, or admin area'}.`,
    database: `For “${projectName}”, this could ${dataUse}.`,
    storage: `For “${projectName}”, this could support a gallery, customer uploads, or documents attached to ${booking ? 'a booking' : 'a form'}.`,
    deployment: `For “${projectName}”, this puts the main site and its supporting pieces online together.`,
    payments: `For “${projectName}”, this could support ${booking ? 'booking deposits or appointment fees' : commerce ? 'product checkout and order payments' : 'paid services, checkout, or memberships'}.`,
    email: `For “${projectName}”, this could send ${booking ? 'booking confirmations and reminders' : commerce ? 'order confirmations and receipts' : 'form confirmations, customer updates, or notifications'}.`,
    domain: `For “${projectName}”, this attaches a custom address to its live deployment.`,
    observability: `For “${projectName}”, this could help catch errors in the site and its added services.`,
  };
  return Object.fromEntries(Object.entries(manifest.slots || {}).map(([id, slot]) => {
    const definition = SERVICES[id];
    if (!definition) return [id, null];
    const dependencies = recommendStack({ features: [definition[2]] }).requiredSlots.filter(key => key !== id);
    return [id, {
      label: definition[0], explanation: definition[1], application: uses[id],
      feature: definition[2], dependencies: dependencies.map(key => ({ id: key, label: STACK_CATALOG[key]?.label || key, status: manifest.slots[key]?.status || 'not_checked' })),
      status: slot.status, canSetup: Boolean(actions[id]?.available), setupLabel: actions[id]?.label || null,
      blocker: actions[id]?.available === false ? actions[id]?.blocker || 'This service still needs a supported setup path.' : null,
    }];
  }));
}

export function connectionScopeMessage(project, guidance) {
  return `Help me understand and scope ${guidance.label} for my existing project “${project.label}”. ${guidance.application} Explain what it would add, where it should fit, and which connections are missing or ready. Ask me one focused question before we decide the scope. Do not build, provision, publish, or mark anything connected yet. What should we decide first?`;
}
