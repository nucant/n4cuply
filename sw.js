// Service worker:
// 1) Caches the app files so it opens fast (and offline).
// 2) Forwards "stream/<fileId>" requests to Drive with the token, so songs
//    start without a full download and seeking works.
const CACHE = 'n4cuply-v22';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'config.js',
  'js/auth.js',
  'js/drive.js',
  'js/library.js',
  'js/player.js',
  'js/meta.js',
  'js/store.js',
  'js/covers.js',
  'js/lyrics.js',
  'js/settings.js',
  'js/sources.js',
  'js/organize.js',
  'js/online.js',
  'js/tagwrite.js',
  'js/artists.js',
  'js/analyze.js',
  'version.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];
const DRIVE = 'https://www.googleapis.com/drive/v3/files/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  const i = url.pathname.indexOf('/stream/');
  if (i !== -1) {
    event.respondWith(stream(event.request, url, url.pathname.slice(i + 8)));
    return;
  }

  // App files: network first, cache as fallback (so the app opens offline).
  event.respondWith((async () => {
    try {
      // Always ask GitHub (not the browser's saved copy) so updates arrive.
      const res = await fetch(event.request, { cache: 'no-cache' });
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    } catch (e) {
      const hit = await caches.match(event.request, { ignoreSearch: true });
      return hit || Response.error();
    }
  })());
});

async function stream(request, url, rawId) {
  const id = decodeURIComponent(rawId);
  const token = url.searchParams.get('t') || '';
  const size = Number(url.searchParams.get('s')) || 0;
  const mime = url.searchParams.get('m') || 'audio/mpeg';

  const headers = { Authorization: 'Bearer ' + token };
  const range = request.headers.get('range');
  if (range) headers.Range = range;

  let upstream;
  try {
    upstream = await fetch(DRIVE + encodeURIComponent(id) + '?alt=media', { headers });
  } catch (e) {
    return new Response('network error', { status: 504 });
  }
  if (!upstream.ok) {
    return new Response(null, { status: upstream.status });
  }

  // Drive doesn't expose every header to the browser, so rebuild them from the known size.
  const out = new Headers({ 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  if (upstream.status === 206 && size) {
    const m = /bytes=(\d*)-(\d*)/.exec(range || '');
    let start = m && m[1] !== '' ? Number(m[1]) : 0;
    let end = m && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (m && m[1] === '' && m[2] !== '') {
      // "bytes=-500" means the last 500 bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    const cr = upstream.headers.get('Content-Range');
    out.set('Content-Range', cr || `bytes ${start}-${end}/${size}`);
    out.set('Content-Length', String(end - start + 1));
  } else if (size) {
    out.set('Content-Length', String(size));
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
