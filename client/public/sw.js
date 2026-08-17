// v3: navigations go network-first, fixing stale index.html after deploy —
// see fetch handler below.
const CACHE_NAME = 'shiftly-cache-v3';

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
  // Take over from any previously-installed worker as soon as this one
  // finishes installing, instead of sitting "waiting" until every open tab
  // closes — that delay is what let stale navigations linger after a deploy.
  self.skipWaiting();
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
    caches.keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
        )
      )
      // Control already-open tabs immediately rather than only tabs opened
      // after this activation, so the fix reaches sessions already on the site.
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Navigations must always hit the network: this is the document that names
  // the deploy's current hashed asset filenames. A deploy wipes and rebuilds
  // those hashes, so serving a cached-first index.html 404s on assets a since
  // -cleaned deploy no longer has — that was the whole blank-screen bug. Only
  // fall back to the precached shell when the network is genuinely down.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Everything else is a hashed, content-addressed asset — its filename
  // changes whenever its content does, so a cached copy can never go stale
  // under a different name, and cache-first is both safe and fast here.
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
