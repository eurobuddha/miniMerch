/**
 * @file Service Worker for miniMerch PWA
 * @version 1.0.0
 */

const CACHE_NAME = 'minimerch-v2';
const STATIC_ASSETS = [
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
    '/config.js',
    '/products.js',
    '/mds.js',
    '/icon.svg',
    '/favicon.ico',
    '/minima_logo.png',
    '/minima_logo_bw.svg',
    '/usdt_icon.svg'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .catch((err) => {
                console.error('Service Worker: Cache failed', err);
            })
    );
    // Skip waiting to activate immediately
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('Service Worker: Deleting old cache', name);
                        return caches.delete(name);
                    })
            );
        })
    );
    // Claim clients immediately
    self.clients.claim();
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip API calls
    if (event.request.url.includes('/api/')) return;

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Return cached version if found
                if (response) {
                    return response;
                }

                // Fetch from network
                return fetch(event.request)
                    .then((networkResponse) => {
                        // Don't cache if not successful
                        if (!networkResponse || networkResponse.status !== 200) {
                            return networkResponse;
                        }

                        // Clone response for caching
                        const responseToCache = networkResponse.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return networkResponse;
                    })
                    .catch(() => {
                        // Network failed, try to return offline page for HTML requests
                        if (event.request.headers.get('accept')?.includes('text/html')) {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});

// Background sync for pending orders
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-orders') {
        event.waitUntil(syncPendingOrders());
    }
});

/**
 * Sync pending orders
 * @returns {Promise}
 */
async function syncPendingOrders() {
    // This would sync any pending orders stored in IndexedDB
    console.log('Service Worker: Syncing pending orders...');
    // Implementation depends on your app's needs
}

// Push notifications (for new orders)
self.addEventListener('push', (event) => {
    const data = event.data?.json() || {};
    const title = data.title || 'New Order!';
    const options = {
        body: data.body || 'You have a new order',
        icon: '/icon.svg',
        badge: '/favicon.ico',
        tag: data.tag || 'new-order',
        requireInteraction: true,
        data: data
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window' })
            .then((clientList) => {
                // Focus existing window if open
                for (const client of clientList) {
                    if (client.url === '/' && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new window
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
    );
});
