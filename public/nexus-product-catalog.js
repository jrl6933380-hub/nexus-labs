// Stable language for the Nexus family. The chat shell, onboarding, and future
// billing UI should all read from this map instead of redefining the products.
export const NEXUS_PRODUCTS = Object.freeze({
  chat: Object.freeze({ name: 'Nex Chat', promise: 'Your everyday AI and the front door to Nexus.', icon: '✦' }),
  forge: Object.freeze({ name: 'Nexus Forge', promise: 'The private production home for Forge callers.', icon: '⚒' }),
  life: Object.freeze({ name: 'Nexus Life', promise: 'Build a better life.', icon: '◌' }),
  legacy: Object.freeze({ name: 'Nexus Legacy', promise: 'Keep what matters alive.', icon: '◇' }),
  teams: Object.freeze({ name: 'Nexus Teams', promise: 'Build together.', icon: '⬡' }),
});

export const NEX_CHAT_PLANS = Object.freeze({
  free: Object.freeze({ name: 'Free', price: 0, panels: 0, description: 'Nex Chat' }),
  pro: Object.freeze({ name: 'Pro', price: 10, panels: 3, description: 'Nex Chat + 3 Workbench panels' }),
  plus: Object.freeze({ name: 'Plus', price: 20, panels: 10, description: 'Nex Chat + 10 interconnected Workbench panels' }),
});

export const NEX_CHAT_MODES = Object.freeze({
  chat: Object.freeze({ name: 'Chat', purpose: 'Talk, think, plan, and operate connected Nexus products.', buildTools: false }),
  workbench: Object.freeze({ name: 'Workbench', purpose: 'Build and ship full-stack websites, apps, businesses, and intelligences.', buildTools: true }),
});
