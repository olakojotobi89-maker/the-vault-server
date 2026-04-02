const CACHE_NAME = 'vault-v1';
const ASSETS = [
  '/',
  '/home.html',
  '/search.html',
  '/profile.html',
  '/settings.html',
  '/signup.html',
  '/login.html',
  '/vault-logo.png'
];

// Install Service Worker and cache the essential files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate the worker and clear out any old versions of the cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

// Intercept network requests to serve cached files if they exist
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});