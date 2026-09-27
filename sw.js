// Service worker:
// 1) App-er file gulo cache kore, jate taratari khole.
// 2) "stream/<fileId>" request Drive-e pathay token soho, jate gaan
//    puro download na kore-i shuru hoy ar seek kaaj kore.
const CACHE = 'my-player-v1';
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

  // App file: age network, na pele cache (offline-e-o app khule).
  event.respondWith((async () => {
    try {
      const res = await fetch(event.request);
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

  // Drive shob header browser-ke dekhay na, tai size theke nijerai banai.
  const out = new Headers({ 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  if (upstream.status === 206 && size) {
    const m = /bytes=(\d*)-(\d*)/.exec(range || '');
    let start = m && m[1] !== '' ? Number(m[1]) : 0;
    let end = m && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (m && m[1] === '' && m[2] !== '') {
      // "bytes=-500" mane sesh-er 500 byte
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
