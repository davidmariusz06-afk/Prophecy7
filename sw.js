// The Prophecy — Service Worker
// Bump CACHE_VERSION whenever you deploy an update
const CACHE_VERSION = 'prophecy-v4';

const STATIC_ASSETS = [
  './',
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400;500&family=Syne:wght@400;700;800&display=swap',
];

// ── INSTALL: cache static assets ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      // Cache what we can; don't fail install if a resource is unavailable
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: delete old caches ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first for Firebase, cache-first for static ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for Firebase (real-time data must be live)
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('firebaseio') ||
    url.hostname.includes('googleapis') && url.pathname.includes('identitytoolkit')
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For everything else: try network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful GET responses
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // For navigation requests, return the app shell
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

// ── WEIGH-IN REMINDER (message from app) ──────────────────
self.addEventListener('message', event => {
  if (event.data?.type !== 'SCHEDULE_REMINDER') return;
  const { enabled, time } = event.data;
  // Store reminder config in cache for background sync
  caches.open(CACHE_VERSION).then(cache => {
    cache.put('/_reminder_config', new Response(JSON.stringify({ enabled, time })));
  });
});

// Daily reminder via periodic background sync (if supported)
self.addEventListener('periodicsync', event => {
  if (event.tag !== 'weigh-in-reminder') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cfg = await cache.match('/_reminder_config');
    if (!cfg) return;
    const { enabled, time } = await cfg.json();
    if (!enabled) return;
    const [h, m] = (time || '07:00').split(':').map(Number);
    const now = new Date();
    if (now.getHours() === h && now.getMinutes() >= m && now.getMinutes() < m + 30) {
      self.registration.showNotification('The Prophecy ⚖️', {
        body: "Time to weigh in! Keep your streak alive.",
        icon: '/icons/icon-192.png', badge: '/icons/icon-72.png', tag: 'weigh-in',
      });
    }
  })());
});
