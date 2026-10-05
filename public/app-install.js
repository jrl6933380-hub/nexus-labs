let deferredInstallPrompt = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    window.dispatchEvent(new CustomEvent('nexus:install-ready'));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    window.dispatchEvent(new CustomEvent('nexus:installed'));
  });
}

export function isIosDevice(navigatorObject = globalThis.navigator) {
  const userAgent = String(navigatorObject?.userAgent || '');
  const platform = String(navigatorObject?.platform || '');
  return /iPhone|iPad|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && Number(navigatorObject?.maxTouchPoints) > 1);
}

export function isStandalone(windowObject = globalThis.window, navigatorObject = globalThis.navigator) {
  return Boolean(
    navigatorObject?.standalone
    || windowObject?.matchMedia?.('(display-mode: standalone)')?.matches,
  );
}

export function nexusInstallState({
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
} = {}) {
  if (isStandalone(windowObject, navigatorObject)) return 'installed';
  if (deferredInstallPrompt) return 'prompt';
  if (isIosDevice(navigatorObject)) return 'ios';
  return 'instructions';
}

export async function installNexus() {
  if (!deferredInstallPrompt) return { outcome: 'instructions' };
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  return { outcome: choice?.outcome || 'dismissed' };
}

export function registerNexusApp(navigatorObject = globalThis.navigator) {
  if (!navigatorObject?.serviceWorker) return Promise.resolve(null);
  return navigatorObject.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => null);
}
