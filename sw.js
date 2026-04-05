/**
 * sw.js — Service Worker AstroMate
 * Stratégie : Cache First (offline-first)
 * La PWA doit fonctionner sans réseau en zone rurale
 */

const CACHE_NAME = 'astromate-v1';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 jours

// Ressources à mettre en cache immédiatement à l'installation
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/app.js',
  '/js/astro.js',
  '/js/renderer.js',
  '/js/projection.js',
  '/js/catalog.js',
  '/data/stars.json',
  '/data/constellations.json',
  '/data/messier.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ─── Installation ─────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installation…');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Mise en cache des ressources');
        // On essaie de cacher chaque ressource individuellement
        // pour ne pas bloquer l'install si une ressource manque
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn(`[SW] Impossible de cacher ${url}:`, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ─── Activation — nettoyage des vieux caches ───────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Suppression ancien cache :', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch — Cache First ───────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Ne pas intercepter les requêtes non-GET
  if (event.request.method !== 'GET') return;

  // Ne pas intercepter les requêtes vers d'autres origines
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      // 1. Cherche dans le cache
      const cached = await cache.match(event.request);
      if (cached) {
        // Mise à jour en arrière-plan si la ressource est vieille
        const dateHeader = cached.headers.get('date');
        if (dateHeader) {
          const age = Date.now() - new Date(dateHeader).getTime();
          if (age > CACHE_DURATION) {
            fetch(event.request)
              .then(res => res.ok && cache.put(event.request, res.clone()))
              .catch(() => {}); // silencieux si offline
          }
        }
        return cached;
      }

      // 2. Sinon, fetch depuis le réseau et met en cache
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch (err) {
        // 3. Offline et pas en cache → page de fallback
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return cache.match('/index.html');
        }
        throw err;
      }
    })
  );
});

// ─── Message — Force refresh ───────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
