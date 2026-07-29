const CACHE_NAME = 'shiftly-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/src/main.ts',
  '/src/App.jsx',
  '/src/index.css',
  '/manifest.json',
  '/favicon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    })
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
    icon: '/favicon.svg',
    badge: '/favicon.svg',
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
