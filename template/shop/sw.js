/**
 * @file Service Worker for miniMerch PWA
 * @version 2.0.0
 */

const CACHE_NAME = 'minimerch-v2';

// Assets to precache — excludes config.js and products.js which are
// regenerated on every build and must always be fetched from the network.
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/db.js',
    '/cart.js',
    '/messaging.js',
    '/price.js',
    '/i18n.js',
    '/ui.js',
    '/mds.js',
    '/icon.svg',
    '/favicon.ico',
    '/minima_logo.png',
    '/minima_logo_bw.svg',
    '/usdt_icon.svg'
];

// Files that change on every build — always fetch from network, never cache.
const NETWORK_ONLY = ['/config.js', '/products.js'];

// Install event - cache static assets, then skip waiting only after cache is ready
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching static assets');
                return cache.addAll(PRECACHE_ASSETS);
            })
            .then(() => {
                // Only skip waiting once cache is fully populated
                return self.skipWaiting();
            })
            .catch((err) => {
                console.error('Service Worker: Cache failed', err);
                throw err; // Fail the install so the browser retries
            })
    );
});

// Activate event - clean up old caches and claim clients atomically
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        Promise.all([
            caches.keys().then((cacheNames) =>
                Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.log('Service Worker: Deleting old cache', name);
                            return caches.delete(name);
                        })
                )
            ),
            self.clients.claim()
        ])
    );
});

// Fetch event
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('/api/')) return;

    const url = new URL(event.request.url);

    // Network-only: config.js and products.js are regenerated on every build
    if (NETWORK_ONLY.some(p => url.pathname.endsWith(p))) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response('', { status: 503, statusText: 'Service Unavailable' })
            )
        );
        return;
    }

    // Cache-first for all other static assets
    event.respondWith(
        caches.match(event.request)
            .then((cached) => {
                if (cached) return cached;

                return fetch(event.request)
                    .then((networkResponse) => {
                        if (!networkResponse || networkResponse.status !== 200) {
                            return networkResponse;
                        }
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                        return networkResponse;
                    })
                    .catch(() => {
                        if (event.request.headers.get('accept')?.includes('text/html')) {
                            return caches.match('/index.html');
                        }
                        return new Response('', { status: 503, statusText: 'Service Unavailable' });
                    });
            })
    );
});
