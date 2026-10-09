/* ============================================================
   sw.js — Service Worker del Editor de Imagenes JPB
   - Cache-first con fallback a red
   - Soporte Share Target (POST multipart) y File Handlers
   - Estrategias separadas para app shell, iconos y datos
   ============================================================ */

const VERSION = 'jpb-v1.0.0';
const CACHE_STATIC  = `jpb-static-${VERSION}`;
const CACHE_RUNTIME = `jpb-runtime-${VERSION}`;

/* Archivos que forman el "app shell" — se cachean al instalar */
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './manifest.json',
  './icons/icon-64.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* ─── INSTALL ──────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      // addAll falla entero si algún recurso falla; usamos add individual tolerante
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] No se pudo precachear', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ─── ACTIVATE ─────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_STATIC && k !== CACHE_RUNTIME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ─── FETCH ────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo GET se cachea (POST son Share Target)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Ignorar esquemas no http(s)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Navegación: network-first para permitir actualizaciones,
  // con fallback a index.html cacheado (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_RUNTIME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Resto: cache-first con revalidación en background (stale-while-revalidate)
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((res) => {
        // Cachear solo respuestas válidas
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_RUNTIME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => null);

      return cached || networkFetch;
    })
  );
});

/* ─── MENSAJES DESDE EL CLIENTE ────────────────────────────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});