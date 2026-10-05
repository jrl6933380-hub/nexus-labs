const SHELL_CACHE = 'nexus-shell-v1';
const SHELL_FILES = [
  '/offline.html',
  '/manifest.webmanifest',
  '/app-icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Never cache authenticated pages or account-specific HTML. If navigation
  // cannot reach Nexus, use the deliberately data-free offline screen.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  // Static assets stay network-first so a deployment cannot strand an
  // installed app on old JavaScript. The cache is only an offline fallback.
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request)),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json?.() || {}; } catch { data = { body: event.data?.text?.() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Nexus', {
    body: data.body || 'Something needs your attention.',
    icon: '/api/app-icon',
    badge: '/api/app-icon',
    tag: data.tag || 'nexus-alert',
    renotify: true,
    data: { url: data.url || '/workspace.html?view=messages' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/workspace.html?view=messages', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); return existing.focus(); }
    return self.clients.openWindow(target);
  }));
});
