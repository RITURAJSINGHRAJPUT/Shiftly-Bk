// v2: repointed at the generated brand icons.
const CACHE_NAME = 'shiftly-cache-v2';

// cache.addAll is atomic — one 404 rejects the whole batch and nothing is
// cached at all. The previous list asked for /src/main.ts (this project has
// main.jsx) along with other source paths that only exist under the dev server
// and are bundled away by a production build, so the precache had been failing
// on every install. Only URLs that resolve in both dev and prod belong here.
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/brand/favicon-32.png',
  '/brand/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
});

// Without this, bumping CACHE_NAME achieves nothing: caches.match() below
// searches every cache in the origin, so entries from an older version would go
// on being served alongside the new ones.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(e.request).catch(() => {
        // Return offline layout if applicable
      });
    })
  );
});

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : { title: 'Shiftly Alert', body: 'New update available!' };
  const options = {
    body: data.body,
    icon: '/brand/icon-192.png',
    badge: '/brand/favicon-48.png',
    data: data.actionUrl
  };
  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.notification.data) {
    e.waitUntil(
      clients.openWindow(e.notification.data)
    );
  }
});
