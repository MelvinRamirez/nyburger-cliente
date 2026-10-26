// Service worker del shell de la PWA de comensal (`diner-pwa-shell`).
//
// Precachea exclusivamente el app shell versionado (HTML, CSS, JS, manifest
// e íconos). Nunca cachea ni intercepta respuestas de la API del backend
// (script.google.com / script.googleusercontent.com): esos requests van
// siempre directo a la red, sin lectura ni escritura de caché, incluso
// estando offline (`diner-pwa-shell`, "API Requests Are Always Network-Only").

const CACHE_PREFIX = 'foodc-shell-';
const CACHE_VERSION = 'foodc-shell-v11'; // se incrementa en cada deploy que cambie archivos del shell

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/config.js',
  './js/messages.js',
  './js/store.js',
  './js/actions.js',
  './js/cart.js',
  './js/table.js',
  './js/api.js',
  './js/persistence.js',
  './js/format.js',
  './js/effects.js',
  './js/main.js',
  './js/views/dom.js',
  './js/views/category-nav.js',
  './js/views/menu-view.js',
  './js/views/table-modal.js',
  './js/views/cart-sheet.js',
  './js/views/submit-view.js',
  './js/views/receipt-view.js',
  './img/placeholder-dish.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Cualquier request que no sea GET, o que sea a un origen distinto del
  // propio (la API del backend, imágenes remotas, etc.), se deja pasar sin
  // intervención: sin `respondWith` el navegador lo maneja como siempre.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate' && request.destination === 'document') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request)),
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
