/*
 * Inverse service worker — keeps the counter's screens usable with no signal.
 *
 * - App code and fonts (/_next/static, icons): cache first; they never change
 *   under the same URL.
 * - Counter pages (/count…): network first; the last good copy is kept and
 *   served when there is no connection, so the app opens and a room page
 *   reloads offline. Saving while offline is handled by the page itself
 *   (IndexedDB outbox), not here.
 * - Everything else (server actions, Supabase, the manager pages) passes
 *   straight through.
 */
const VERSION = 'v1';
const STATIC = `inverse-static-${VERSION}`;
const PAGES = `inverse-pages-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== STATIC && key !== PAGES) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/') || /^\/(icon-|apple-icon|favicon|fonts\/|zxing\/)/.test(url.pathname.slice(0))) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Full page loads of the counter's screens.
  if (req.mode === 'navigate' && url.pathname.startsWith('/count')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const res = await fetch(req);
          if (res.ok && !res.redirected) cache.put(url.pathname, res.clone());
          return res;
        } catch {
          return (await cache.match(url.pathname)) || (await cache.match('/count')) || Response.error();
        }
      })(),
    );
  }
});
