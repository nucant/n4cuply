import {
  initAuth, hasToken, canWrite, expiresSoon, signIn, signOut, primaryAccount, accountName, knownAccounts,
} from './js/auth.js';
import { AuthError, uploadFile, createFolder, getFolder } from './js/drive.js';
import {
  scanSource, loadScanCache, clearCache, loadMetaCache, missingMeta, readMissingMeta, build, refFor, LocalPermissionError,
} from './js/library.js';
import {
  listSources, sourceById, accountOf, addDriveSource, addLocalSource, removeSource, canAddSource, MAX_EXTRA,
  localSupported, localPermission, requestLocal, readBlob,
} from './js/sources.js';
import { first, techLine, qualityBadge, qualityTag } from './js/meta.js';
import { loadCover, peekCover, applyTint } from './js/covers.js';
import { lyricsFor, activeLine } from './js/lyrics.js';
import { settings, setSetting, parseFolderInput } from './js/settings.js';
import { idbGetAll } from './js/store.js';
import { player } from './js/player.js';

const APP_VERSION = '1.3';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M7.5 4.8c0-.8.9-1.3 1.6-.9l10.6 6.9c.6.4.6 1.4 0 1.8L9.1 19.5c-.7.4-1.6-.1-1.6-.9z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="fill" x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect class="fill" x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M3 6.6c0-.7.8-1.1 1.4-.7l7.6 5.4c.5.3.5 1.1 0 1.4l-7.6 5.4c-.6.4-1.4 0-1.4-.7zM12 6.6c0-.7.8-1.1 1.4-.7l7.6 5.4c.5.3.5 1.1 0 1.4l-7.6 5.4c-.6.4-1.4 0-1.4-.7z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M21 6.6c0-.7-.8-1.1-1.4-.7L12 11.3c-.5.3-.5 1.1 0 1.4l7.6 5.4c.6.4 1.4 0 1.4-.7zM12 6.6c0-.7-.8-1.1-1.4-.7L3 11.3c-.5.3-.5 1.1 0 1.4l7.6 5.4c.6.4 1.4 0 1.4-.7z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4h4v4M4 20L20 4M20 16v4h-4M14.5 14.5L20 20M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4"/></svg>',
  repeatOne: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4"/><path d="M11 10.5l1.5-1V15"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="fill" cx="5" cy="12" r="1.8"/><circle class="fill" cx="12" cy="12" r="1.8"/><circle class="fill" cx="19" cy="12" r="1.8"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/></svg>',
  lyrics: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 014 14.5z"/><path d="M8.5 8.5h7M8.5 11.5h4.5"/></svg>',
  queue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h11M4 11h11M4 16h7"/><path class="fill" d="M16 13.5v7l5-3.5z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>',
  drive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3.5h7l6 10.5-3.5 6h-12L2.5 14z"/><path d="M8.5 3.5l6.5 10.5h6.5M2.5 14h13l-3.5 6"/></svg>',
  pc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.2"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v-3a8 8 0 0116 0v3"/><rect class="fill" x="3" y="14" width="5" height="7" rx="1.5"/><rect class="fill" x="16" y="14" width="5" height="7" rx="1.5"/></svg>',
  spinner: '<svg viewBox="0 0 24 24" class="spin" aria-hidden="true"><path d="M12 3a9 9 0 109 9"/></svg>',
};

const scans = {};    // srcId -> scan result
const srcState = {}; // srcId -> { status: 'ok'|'scanning'|'error'|'auth'|'permission', error }
let lib = null;
let scanning = false;
let scanCount = 0;
let scanError = '';
let metaRun = null; // { done, total }
let lists = {};
let installPrompt = null;
let lastRefreshTry = 0;

const allFiles = () => Object.values(scans).flatMap((sc) => sc.files);
const hasScans = () => Object.keys(scans).length > 0;
const defaultScan = () => scans.default || Object.values(scans)[0] || null;

// ================= boot =================
async function boot() {
  registerServiceWorker();
  wireStaticUi();
  for (const src of listSources()) {
    const cached = loadScanCache(src);
    if (cached) scans[src.id] = cached;
    if (src.kind === 'local') localPermission(src.id).then((p) => { srcState[src.id] = { status: p === 'granted' ? 'ok' : 'permission' }; });
  }
  if (hasScans()) {
    await loadMetaCache(allFiles());
    rebuild();
  }

  try {
    await initAuth();
  } catch (e) {
    showLogin(e.message);
    return;
  }

  if (hasToken()) {
    showApp();
    refreshLibrary({ quiet: hasScans() });
  } else if (hasScans()) {
    showApp();
    toast('Connect again to play your music.', { action: 'Connect', onAction: reconnect });
  } else {
    showLogin();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* playback still works without it */ });
}

// ================= screens =================
function showLogin(error = '') {
  $('#app').hidden = true;
  $('#now').hidden = true;
  $('#login').hidden = false;
  const el = $('#login-error');
  el.textContent = error;
  el.hidden = !error;
}

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  render();
}

async function connect() {
  const btn = $('#connect');
  btn.disabled = true;
  try {
    await signIn();
    showApp();
    refreshLibrary();
  } catch (e) {
    showLogin(e.message);
  } finally {
    btn.disabled = false;
  }
}

async function reconnect(account) {
  try {
    await signIn({ account: typeof account === 'string' ? account : '' });
    hideToast();
    player.resumeAfterAuth();
    const stale = listSources().filter((src) => ['auth', 'error'].includes(srcState[src.id]?.status));
    if (!hasScans() || scanError || stale.length) refreshLibrary({ quiet: hasScans() });
    else runMetaScan();
  } catch (e) {
    toast(e.message);
  }
}

/** One click to let the app read a PC folder again (Chrome asks after restarts). */
async function allowLocal(srcId) {
  try {
    if (!(await requestLocal(srcId))) { toast('Access was not allowed.'); return; }
    hideToast();
    player.resumeAfterAuth();
    refreshLibrary({ quiet: true, only: srcId });
  } catch (e) {
    toast(e.message);
  }
}

// ================= library =================
function rebuild() {
  lib = build(Object.values(scans));
  if (player.current()) player.relink(lib.tracksById);
  else player.restore(lib);
}

async function refreshLibrary({ quiet = false, only = '' } = {}) {
  if (scanning) return;
  scanning = true;
  scanCount = 0;
  scanError = '';
  if (!quiet || !lib) render();
  const counts = {};
  const sources = listSources().filter((src) => !only || src.id === only);
  const authNeeded = new Set();
  await Promise.all(sources.map(async (src) => {
    srcState[src.id] = { status: 'scanning' };
    try {
      scans[src.id] = await scanSource(src, (n) => {
        counts[src.id] = n;
        scanCount = Object.values(counts).reduce((a, b) => a + b, 0);
        if (!lib) render();
      });
      srcState[src.id] = { status: 'ok' };
    } catch (e) {
      if (e instanceof AuthError) {
        srcState[src.id] = { status: 'auth', error: e.message };
        authNeeded.add(accountOf(src));
      } else if (e instanceof LocalPermissionError) {
        srcState[src.id] = { status: 'permission', error: e.message };
      } else {
        srcState[src.id] = { status: 'error', error: e.message || "Couldn't load this source." };
      }
    }
  }));
  // Drop cached results of sources that were removed.
  const ids = new Set(listSources().map((src) => src.id));
  for (const id of Object.keys(scans)) if (!ids.has(id)) delete scans[id];

  if (hasScans()) {
    await loadMetaCache(allFiles());
    rebuild();
  } else {
    scanError = srcState.default?.error || 'No music sources could be loaded.';
  }
  if (authNeeded.size) {
    const account = [...authNeeded][0];
    toast(account === primaryAccount() ? 'Your session expired. Connect again.' : `Connect ${account} to load its music.`,
      { action: 'Connect', onAction: () => reconnect(account) });
  }
  scanning = false;
  render();
  if (hasScans()) runMetaScan();
}

let rebuildTimer = 0;
async function runMetaScan() {
  if (metaRun || !hasScans()) return;
  const files = allFiles();
  const missing = missingMeta(files);
  if (!missing.length) return;
  metaRun = { done: 0, total: missing.length };
  renderScanBar();
  let result = { blocked: [] };
  try {
    result = await readMissingMeta(files, (done, total) => {
      metaRun = { done, total };
      renderScanBar();
      if (!rebuildTimer) {
        rebuildTimer = setTimeout(() => {
          rebuildTimer = 0;
          rebuild();
          render();
        }, 2500);
      }
    });
  } finally {
    metaRun = null;
    clearTimeout(rebuildTimer);
    rebuildTimer = 0;
    renderScanBar();
    rebuild();
    render();
  }
  for (const id of result.blocked) {
    const src = sourceById(id);
    if (!src) continue;
    srcState[id] = { status: src.kind === 'local' ? 'permission' : 'auth' };
  }
  if (result.blocked.length) render();
}

// ================= routing =================
function route() {
  const h = location.hash.slice(1);
  let m;
  if ((m = h.match(/^album\/(.+)$/))) return { name: 'album', id: decodeURIComponent(m[1]) };
  if ((m = h.match(/^artist\/(.+)$/))) return { name: 'artist', id: decodeURIComponent(m[1]) };
  if (h === 'songs' || h === 'artists') return { name: h };
  return { name: 'albums' };
}

const scrollMemory = new Map();
let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  scrollMemory.set(lastHash, window.scrollY);
  lastHash = location.hash;
  closeSheet(false);
  const go = () => {
    render();
    window.scrollTo(0, scrollMemory.get(location.hash) || 0);
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(go);
  else go();
});

window.addEventListener('popstate', () => {
  const st = history.state || {};
  setNowOpen(!!st.now, false);
  if (!st.sheet) closeSheet(false);
});

// ================= render =================
let lastHtml = '';
function setMain(html) {
  // Re-rendering identical markup would reset images and scroll; skip it.
  if (html === lastHtml) return false;
  lastHtml = html;
  $('#main').innerHTML = html;
  return true;
}

function render() {
  const main = $('#main');
  lists = {};
  const q = $('#q').value.trim().toLowerCase();

  if (!lib) {
    setMain(scanError ? errorBlock(scanError) : scanningBlock());
    return;
  }
  if (!lib.tracks.length) {
    setMain(scanError ? errorBlock(scanError) : `
      ${noticesHtml()}
      <div class="empty">
        <h2>No songs yet</h2>
        <p>Add FLAC, MP3, M4A, WAV or OGG files to "${esc(defaultScan()?.rootName || 'your music folder')}", or add another source in Settings. Use sub-folders for albums.</p>
        <div class="home-actions">
          <button class="pill-btn light" type="button" data-action="upload">${ICON.upload}<span>Upload songs</span></button>
          <button class="pill-btn" type="button" data-action="refresh">Check again</button>
        </div>
      </div>`);
    return;
  }

  const r = route();
  let html;
  if (q) html = renderSearch(q);
  else if (r.name === 'album' && lib.albumsById[r.id]) html = renderAlbum(lib.albumsById[r.id]);
  else if (r.name === 'artist' && lib.artists.find((a) => a.name === r.id)) html = renderArtist(lib.artists.find((a) => a.name === r.id));
  else html = renderHome(r.name === 'album' || r.name === 'artist' ? 'albums' : r.name);
  if (!setMain(html)) { markPlaying(); return; }
  hydrateArt(main);
  const page = main.querySelector('[data-tint]');
  if (page) tintFromCover(page, page.dataset.tint, page.dataset.seed);
  markPlaying();
}

function scanningBlock() {
  return `
    <div class="empty">
      <div class="loader">${ICON.spinner}</div>
      <h2>Looking for music in your Drive</h2>
      <p>${scanCount ? `Found ${plural(scanCount, 'song')}…` : 'Scanning folders…'}</p>
    </div>`;
}

function errorBlock(msg) {
  return `
    <div class="empty">
      <h2>Couldn't load your library</h2>
      <p>${esc(msg)}</p>
      <div class="home-actions">
        <button class="pill-btn light" type="button" data-action="refresh">Try again</button>
        <button class="pill-btn" type="button" data-action="settings">Settings</button>
        ${srcState.default?.status === 'auth' ? '<button class="pill-btn" type="button" data-action="connect">Connect</button>' : ''}
      </div>
    </div>`;
}

function noticesHtml() {
  const items = listSources().map((src) => {
    const st = srcState[src.id];
    if (!st || !['auth', 'permission', 'error'].includes(st.status)) return '';
    const name = src.kind === 'local' ? src.name : (scans[src.id]?.rootName || src.name || 'Drive folder');
    const action = st.status === 'permission'
      ? `<button class="pill-btn small light" type="button" data-action="allow-local" data-src="${esc(src.id)}">Allow access</button>`
      : st.status === 'auth'
        ? `<button class="pill-btn small light" type="button" data-action="connect" data-account="${esc(accountOf(src))}">Connect</button>`
        : `<button class="pill-btn small" type="button" data-action="settings">Settings</button>`;
    const text = st.status === 'permission' ? `Allow access to the PC folder "${esc(name)}" to play it.`
      : st.status === 'auth' ? `Connect ${esc(accountOf(src))} to load "${esc(name)}".`
        : `"${esc(name)}": ${esc(st.error || 'failed to load')}`;
    return `<div class="notice">${ICON.alert}<span>${text}</span>${action}</div>`;
  }).join('');
  return items ? `<div class="notices">${items}</div>` : '';
}

function scanBarHtml() {
  if (!metaRun) return '';
  const pct = metaRun.total ? (metaRun.done / metaRun.total) * 100 : 0;
  return `<div class="scan" id="scan"><span>Reading song info · ${metaRun.done} of ${metaRun.total}</span><div class="scan-bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
}

function renderScanBar() {
  const el = $('#scan');
  if (el && metaRun) el.outerHTML = scanBarHtml();
  else if (!el && metaRun && $('.home-head')) $('.home-head').insertAdjacentHTML('beforeend', scanBarHtml());
  else if (el && !metaRun) el.remove();
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function fmtTotal(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}

function renderHome(tab) {
  const nLossless = lib.tracks.filter((t) => t.meta?.lossless).length;
  const nHiRes = lib.tracks.filter((t) => t.meta?.hiRes).length;
  const total = lib.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  lists.all = lib.tracks;
  const head = `
    <section class="home-head">
      <h1>Library</h1>
      ${noticesHtml()}
      <p class="home-stats">${plural(lib.tracks.length, 'song')} · ${plural(lib.albums.length, 'album')}${total ? ' · ' + fmtTotal(total) : ''}${nLossless ? ` · ${nLossless} lossless` : ''}${nHiRes ? ` · ${nHiRes} Hi-Res` : ''}</p>
      <nav class="seg" aria-label="Library">
        <a href="#albums" class="${tab === 'albums' ? 'on' : ''}">Albums</a>
        <a href="#songs" class="${tab === 'songs' ? 'on' : ''}">Songs</a>
        <a href="#artists" class="${tab === 'artists' ? 'on' : ''}">Artists</a>
      </nav>
      <div class="home-actions">
        <button class="pill-btn light" type="button" data-action="play-list" data-list="all">${ICON.play}<span>Play all</span></button>
        <button class="pill-btn" type="button" data-action="shuffle-list" data-list="all">${ICON.shuffle}<span>Shuffle</span></button>
        <button class="pill-btn" type="button" data-action="upload">${ICON.upload}<span>Upload</span></button>
      </div>
      ${scanBarHtml()}
    </section>`;
  if (tab === 'songs') {
    return head + `<section class="section"><div class="rows">${lib.tracks.map((t, i) => songRow(t, 'all', i, { showArt: true })).join('')}</div></section>`;
  }
  if (tab === 'artists') {
    return head + `<section class="section"><div class="artist-list">${lib.artists.map(artistCard).join('')}</div></section>`;
  }
  return head + `<section class="section"><div class="grid">${lib.albums.map(albumCard).join('')}</div></section>`;
}

function renderAlbum(a) {
  lists.album = a.tracks;
  const meta = ['Album', a.year, plural(a.tracks.length, 'song')].filter(Boolean).join(' · ');
  let lastDisc = 0;
  const rows = a.tracks.map((t, i) => {
    const disc = a.discs > 1 && t.discNo !== lastDisc ? `<p class="disc">Disc ${t.discNo}${first(t.meta, 'DISCSUBTITLE') ? ' · ' + esc(first(t.meta, 'DISCSUBTITLE')) : ''}</p>` : '';
    lastDisc = t.discNo;
    return disc + songRow(t, 'album', i, { number: true, hideArtist: t.artist === a.artist });
  }).join('');
  return `
    <div class="page" data-tint="${esc(a.cover)}" data-seed="${esc(a.name)}">
      <header class="page-hero">
        <div class="page-top">
          <button class="round-btn" type="button" data-action="back" aria-label="Back">${ICON.back}</button>
          <button class="round-btn" type="button" data-action="album-info" data-key="${esc(a.key)}" aria-label="Album info">${ICON.more}</button>
        </div>
        <div class="art hero-art" data-cover="${esc(a.cover)}" data-seed="${esc(a.name)}"></div>
        <h1>${esc(a.name)}</h1>
        ${a.artist ? `<a class="hero-artist" href="#artist/${encodeURIComponent(a.artist)}">${esc(a.artist)}</a>` : ''}
        <div class="hero-meta">${esc(meta)}</div>
        ${a.format ? `<div class="chips">${qualityChip(a.tracks[0].meta, a.format)}</div>` : ''}
        <div class="hero-actions">
          <button class="round-btn" type="button" data-action="shuffle-list" data-list="album" aria-label="Shuffle">${ICON.shuffle}</button>
          <button class="pill-btn" type="button" data-action="play-list" data-list="album">${ICON.play}<span>Play</span></button>
          <button class="round-btn" type="button" data-action="upload" data-folder="${esc(a.folderId)}" aria-label="Upload to this album">${ICON.upload}</button>
        </div>
      </header>
      <section class="section"><div class="rows">${rows}</div></section>
      <footer class="page-foot">
        <span>${plural(a.tracks.length, 'song')}${a.duration ? ' · ' + fmtTotal(a.duration) : ''}${a.genre ? ' · ' + esc(a.genre) : ''}</span>
        ${a.label ? `<span>${esc(a.label)}</span>` : ''}
        ${a.copyright ? `<span>${esc(a.copyright)}</span>` : ''}
      </footer>
    </div>`;
}

function renderArtist(ar) {
  lists.artist = ar.tracks.slice().sort((x, y) => x.album.localeCompare(y.album) || x.discNo - y.discNo || x.n - y.n);
  return `
    <div class="page" data-tint="${esc(ar.cover)}" data-seed="${esc(ar.name)}">
      <header class="page-hero artist-hero">
        <div class="page-top">
          <button class="round-btn" type="button" data-action="back" aria-label="Back">${ICON.back}</button>
          <span></span>
        </div>
        <div class="art hero-art" data-cover="${esc(ar.cover)}" data-seed="${esc(ar.name)}"></div>
        <h1>${esc(ar.name)}</h1>
        <div class="hero-meta">Artist · ${plural(ar.albums.length, 'album')} · ${plural(ar.tracks.length, 'song')}</div>
        <div class="hero-actions">
          <button class="round-btn" type="button" data-action="shuffle-list" data-list="artist" aria-label="Shuffle">${ICON.shuffle}</button>
          <button class="pill-btn" type="button" data-action="play-list" data-list="artist">${ICON.play}<span>Play</span></button>
        </div>
      </header>
      <section class="section"><h2 class="section-title">Albums</h2><div class="grid">${ar.albums.map(albumCard).join('')}</div></section>
      <section class="section"><h2 class="section-title">Songs</h2><div class="rows">${lists.artist.map((t, i) => songRow(t, 'artist', i, { showArt: true, hideArtist: true })).join('')}</div></section>
    </div>`;
}

function renderSearch(q) {
  const has = (s) => String(s || '').toLowerCase().includes(q);
  const tracks = lib.tracks.filter((t) => has(t.title) || has(t.artist) || has(t.album) || has(t.genre) || has(first(t.meta, 'COMPOSER')));
  const albums = lib.albums.filter((a) => has(a.name) || has(a.artist));
  const artists = lib.artists.filter((a) => has(a.name));
  lists.search = tracks;
  if (!tracks.length && !albums.length && !artists.length) {
    return `<div class="empty"><h2>No results</h2><p>Nothing matches "${esc(q)}".</p></div>`;
  }
  return `
    ${artists.length ? `<section class="section"><h2 class="section-title">Artists</h2><div class="artist-list">${artists.slice(0, 12).map(artistCard).join('')}</div></section>` : ''}
    ${albums.length ? `<section class="section"><h2 class="section-title">Albums</h2><div class="grid">${albums.map(albumCard).join('')}</div></section>` : ''}
    ${tracks.length ? `<section class="section"><h2 class="section-title">Songs</h2><div class="rows">${tracks.map((t, i) => songRow(t, 'search', i, { showArt: true })).join('')}</div></section>` : ''}`;
}

function qualityChip(meta, text) {
  if (!meta) return '';
  const cls = meta.hiRes ? 'q hires' : meta.lossless ? 'q lossless' : 'q';
  const label = text || `${meta.codec || meta.format}${qualityTag(meta) ? ' ' + qualityTag(meta) : ''}`;
  return `<span class="${cls}">${meta.hiRes ? 'Hi-Res · ' : ''}${esc(label)}</span>`;
}

function albumCard(a) {
  return `
    <a class="card" href="#album/${encodeURIComponent(a.key)}">
      <div class="art" data-cover="${esc(a.cover)}" data-seed="${esc(a.name)}"></div>
      <b>${esc(a.name)}</b>
      <small>${esc(a.artist || plural(a.tracks.length, 'song'))}${a.year ? ' · ' + esc(a.year) : ''}</small>
    </a>`;
}

function artistCard(ar) {
  return `
    <a class="artist-card" href="#artist/${encodeURIComponent(ar.name)}">
      <div class="art" data-cover="${esc(ar.cover)}" data-seed="${esc(ar.name)}"></div>
      <b>${esc(ar.name)}</b>
      <small>${plural(ar.tracks.length, 'song')}</small>
    </a>`;
}

function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function songRow(t, list, i, { number = false, showArt = false, hideArtist = false } = {}) {
  const sub = [hideArtist ? '' : t.artist, list === 'album' ? '' : t.album].filter(Boolean).join(' · ');
  return `
    <div class="row" role="button" tabindex="0" data-action="play-track" data-list="${list}" data-i="${i}" data-id="${esc(t.id)}">
      ${number ? `<span class="num">${t.n}</span>` : showArt ? `<span class="art sm" data-cover="${esc(t.cover)}" data-seed="${esc(t.album)}"></span>` : ''}
      <span class="row-text"><b>${esc(t.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <span class="row-end">
        ${t.meta && !t.meta.error ? qualityChip(t.meta) : `<span class="q">${esc(t.ext)}</span>`}
        <span class="dur">${t.duration ? fmt(t.duration) : ''}</span>
        <button class="more" type="button" data-action="track-info" data-id="${esc(t.id)}" aria-label="Song info">${ICON.more}</button>
      </span>
    </div>`;
}

function markPlaying() {
  const cur = player.current();
  document.querySelectorAll('.row.is-current').forEach((el) => el.classList.remove('is-current'));
  if (!cur) return;
  document.querySelectorAll(`.row[data-id="${CSS.escape(cur.id)}"]`).forEach((el) => el.classList.add('is-current'));
}

// ================= artwork & colour =================
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function initials(s) {
  const words = String(s || '♪').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '♪') + (words[1]?.[0] || '')).toUpperCase();
}

const getTrack = (id) => lib?.tracksById[id];
const NEUTRAL = [230, 0.06, 0.4];

function tint(el, color, hue) {
  if (!settings.dynamicColor) applyTint(el, NEUTRAL);
  else applyTint(el, color, hue);
}

function paintArt(el, seed, coverId) {
  const h = hash(seed || '');
  el.style.setProperty('--h1', h % 360);
  el.style.setProperty('--h2', (h >> 9) % 360);
  if (coverId && el.dataset.want === coverId && el.classList.contains('has-img')) return loadCover(coverId, getTrack);
  const ready = coverId && peekCover(coverId);
  if (ready) {
    el.dataset.want = coverId;
    el.style.backgroundImage = `url("${ready.url}")`;
    el.classList.add('has-img', 'instant');
    el.innerHTML = '';
    return Promise.resolve(ready);
  }
  el.classList.remove('instant');
  el.style.backgroundImage = '';
  el.classList.remove('has-img');
  el.innerHTML = `<span>${esc(initials(seed))}</span>`;
  el.dataset.want = coverId || '';
  if (!coverId) return Promise.resolve(null);
  return loadCover(coverId, getTrack).then((c) => {
    if (c && el.dataset.want === coverId) {
      el.style.backgroundImage = `url("${c.url}")`;
      el.classList.add('has-img');
      el.innerHTML = '';
    }
    return c;
  });
}

const artObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      artObserver.unobserve(e.target);
      paintArt(e.target, e.target.dataset.seed, e.target.dataset.cover);
    }
  }, { rootMargin: '300px' })
  : null;

function hydrateArt(root) {
  root.querySelectorAll('.art[data-seed]').forEach((el) => {
    if (el.dataset.cover && peekCover(el.dataset.cover)) { paintArt(el, el.dataset.seed, el.dataset.cover); return; }
    const h = hash(el.dataset.seed || '');
    el.style.setProperty('--h1', h % 360);
    el.style.setProperty('--h2', (h >> 9) % 360);
    el.innerHTML = `<span>${esc(initials(el.dataset.seed))}</span>`;
    if (artObserver && el.dataset.cover) artObserver.observe(el);
    else paintArt(el, el.dataset.seed, el.dataset.cover);
  });
}

function tintFromCover(el, coverId, seed) {
  tint(el, null, hash(seed || '') % 360);
  if (!coverId) return;
  loadCover(coverId, getTrack).then((c) => { if (c?.color) tint(el, c.color); });
}

// ================= now playing =================
let currentLyrics = null;
let lyricsTrackId = '';

function updatePlayerUi() {
  const t = player.current();
  $('#mini').hidden = !t;
  document.body.classList.toggle('has-mini', !!t);
  if (!t) return;
  const m = t.meta;
  $('#mini-title').textContent = t.title;
  $('#mini-artist').textContent = t.artist || t.album;
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = t.artist || t.album;
  $('#np-tech').textContent = m && !m.error ? techLine(m) : t.ext;
  $('#np-tech').hidden = !settings.showTech;

  const badge = $('#np-badge');
  if (m && !m.error) {
    badge.innerHTML = `${m.lossless ? ICON.headphones : ''}<span>${esc(qualityBadge(m))}</span>`;
    badge.classList.toggle('hires', !!m.hiRes);
  } else {
    badge.innerHTML = '';
  }

  const lyricKey = `${t.id}:${t.lrcId}:${t.meta?.v || 0}`;
  if (lyricsTrackId !== lyricKey) {
    lyricsTrackId = lyricKey;
    currentLyrics = null;
    lastLyricIdx = -2;
    updateLyricPreview();
    lyricsFor(t, loadText).then((ly) => {
      if (lyricsTrackId !== lyricKey) return;
      currentLyrics = ly;
      lastLyricIdx = -2;
      updateLyricPreview();
      if (sheetKind === 'lyrics') openLyrics(false);
    });
  }

  document.title = `${t.title}${t.artist ? ' · ' + t.artist : ''}`;
  const seed = t.album;
  const tinted = [$('#now'), $('#mini'), $('#sheet')];
  if ($('#now').dataset.cover !== (t.cover || seed)) {
    // New cover: seed colour first, the real colour once the image loads.
    $('#now').dataset.cover = t.cover || seed;
    for (const el of tinted) tint(el, null, hash(seed) % 360);
    $('#np-bg-img').style.backgroundImage = '';
  }
  paintArt($('#mini-art'), seed, t.cover);
  paintArt($('#np-art'), seed, t.cover).then((c) => {
    if (!c || player.current()?.id !== t.id) return;
    player.setArtwork(t.id, c.url);
    $('#np-bg-img').style.backgroundImage = settings.dynamicColor ? `url("${c.url}")` : '';
    if (c.color) for (const el of tinted) tint(el, c.color);
  });

  const s = player.state;
  $('#c-shuffle').innerHTML = ICON.shuffle;
  $('#c-shuffle').classList.toggle('on', s.shuffle);
  $('#c-shuffle').setAttribute('aria-pressed', String(s.shuffle));
  $('#c-repeat').innerHTML = s.repeat === 'one' ? ICON.repeatOne : ICON.repeat;
  $('#c-repeat').classList.toggle('on', s.repeat !== 'off');
  $('#c-repeat').setAttribute('aria-label', { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[s.repeat]);
  if (sheetKind === 'queue') openQueue(false);
  if (sheetKind === 'info' && sheetTrackId === t.id) openTrackInfo(t.id, false);
  markPlaying();
  updatePlayState();
}

function updatePlayState() {
  const s = player.state;
  const icon = s.loading ? ICON.spinner : s.playing ? ICON.pause : ICON.play;
  const label = s.playing ? 'Pause' : 'Play';
  for (const id of ['#mini-play', '#c-play']) {
    $(id).innerHTML = icon;
    $(id).setAttribute('aria-label', label);
  }
}

let seeking = false;
let rafId = 0;
function progressLoop() {
  // Smooth progress bars between the browser's ~4 per second time updates.
  cancelAnimationFrame(rafId);
  const step = () => {
    if (player.audio.paused) return;
    paintProgress();
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

function paintProgress() {
  const a = player.audio;
  const d = a.duration || player.current()?.duration || 0;
  const pct = d > 0 ? a.currentTime / d : 0;
  $('#mini-progress').style.transform = `scaleX(${pct.toFixed(4)})`;
  if (nowOpen && !seeking) {
    const seek = $('#seek');
    seek.value = Math.round(pct * 1000);
    seek.style.setProperty('--pct', (pct * 100).toFixed(2) + '%');
  }
}

function updateTime() {
  const a = player.audio;
  const d = a.duration || player.current()?.duration || 0;
  const pct = d > 0 ? a.currentTime / d : 0;
  $('#mini-progress').style.transform = `scaleX(${pct.toFixed(4)})`;
  const seek = $('#seek');
  if (!seeking) seek.value = Math.round(pct * 1000);
  seek.style.setProperty('--pct', (seek.value / 10) + '%');
  const cur = seeking ? (seek.value / 1000) * d : a.currentTime;
  $('#t-cur').textContent = fmt(cur);
  $('#t-left').textContent = '-' + fmt(Math.max(0, d - cur));
  syncLyrics(a.currentTime);
}

let nowOpen = false;
function setNowOpen(open, push = true) {
  if (open === nowOpen) return;
  nowOpen = open;
  const el = $('#now');
  if (open) {
    el.classList.remove('closing');
    el.hidden = false;
    updateTime();
  } else {
    el.classList.add('closing');
    setTimeout(() => { if (!nowOpen) { el.hidden = true; el.classList.remove('closing'); } }, 260);
  }
  document.body.classList.toggle('now-open', open);
  if (push && open) history.pushState({ now: true }, '');
  else if (push && !open && history.state?.now) history.back();
}

// ================= lyrics =================
const textCache = new Map();
function loadText(id) {
  if (!textCache.has(id)) {
    textCache.set(id, readBlob(refFor(id)).then((b) => b.text()).catch((e) => { textCache.delete(id); throw e; }));
  }
  return textCache.get(id);
}

let lastLyricIdx = -2;
let userScrolledAt = 0;

function updateLyricPreview() {
  const el = $('#np-lyric');
  const ly = currentLyrics;
  let text = '';
  if (ly && settings.lyricsPreview) {
    if (ly.synced) {
      const i = activeLine(ly.lines, player.audio.currentTime || 0);
      text = (ly.lines[Math.max(0, i)] || {}).text || '';
      if (!text) text = ly.lines.find((l, k) => k > i && l.text)?.text || '';
    } else {
      text = ly.lines.find((l) => l.text)?.text || '';
    }
  }
  el.hidden = !text;
  if (text && el.dataset.text !== text) {
    el.dataset.text = text;
    el.innerHTML = `<span>${esc(text)}</span>${ICON.chevron}`;
  }
}

function syncLyrics(time) {
  const ly = currentLyrics;
  if (!ly?.synced) return;
  const idx = activeLine(ly.lines, time);
  if (idx !== lastLyricIdx) {
    lastLyricIdx = idx;
    updateLyricPreview();
    if (sheetKind === 'lyrics') {
      const box = $('#sheet-body');
      box.querySelectorAll('.ly').forEach((p) => {
        const i = Number(p.dataset.i);
        p.classList.toggle('on', i === idx);
        p.classList.toggle('past', i < idx);
      });
      const cur = box.querySelector(`.ly[data-i="${idx}"]`);
      if (cur && Date.now() - userScrolledAt > 4000) {
        box.scrollTo({ top: cur.offsetTop - box.clientHeight * 0.35, behavior: 'smooth' });
      }
    }
  }
  if (sheetKind === 'lyrics' && idx >= 0 && ly.lines[idx].words) {
    $('#sheet-body').querySelectorAll(`.ly[data-i="${idx}"] .w`).forEach((w) => {
      w.classList.toggle('sung', Number(w.dataset.t) <= time + 0.05);
    });
  }
}

function openLyrics(push = true) {
  const t = player.current();
  if (!t) return;
  const ly = currentLyrics;
  const mayHave = t.lrcId || first(t.meta, 'LYRICS') || t.meta?.syncedLyrics;
  let html;
  if (!ly && mayHave) {
    html = `<div class="empty small"><div class="loader">${ICON.spinner}</div></div>`;
  } else if (!ly) {
    html = `<p class="info-note first">No lyrics for this song yet.</p>
      <p class="info-note">For synced lyrics, upload a <b>.lrc</b> file with the same name as the song into the same folder, for example "${esc(t.file.replace(/\.[^.]+$/, ''))}.lrc". Lyrics saved in the file's lyrics tag also work.</p>`;
  } else if (ly.synced) {
    html = `<div class="lyrics-view">${ly.lines.map((l, i) => `
      <p class="ly" data-i="${i}" data-t="${l.t}" role="button" tabindex="0">${l.words
        ? l.words.map((w) => `<span class="w" data-t="${w.t ?? l.t}">${esc(w.text)}</span>`).join('')
        : (esc(l.text) || '<span class="ly-gap">♪</span>')}</p>`).join('')}
      </div><p class="ly-source">Synced · ${esc(ly.source)} · tap a line to jump to it</p>`;
  } else {
    html = `<div class="lyrics">${esc(ly.lines.map((l) => l.text).join('\n').trim())}</div>
      <p class="ly-source">Not synced · ${esc(ly.source)}. Use an .lrc file with timestamps to sync.</p>`;
  }
  openSheet('lyrics', t.title, html, push);
  $('#sheet').classList.add('lyrics-sheet');
  lastLyricIdx = -2;
  syncLyrics(player.audio.currentTime || 0);
}

// ================= sheet =================
let sheetKind = '';
let sheetTrackId = '';

function openSheet(kind, title, html, push = true) {
  const wasOpen = !!sheetKind;
  sheetKind = kind;
  $('#sheet').classList.remove('lyrics-sheet');
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  hydrateArt($('#sheet-body'));
  $('#sheet').classList.remove('closing');
  $('#sheet-scrim').classList.remove('closing');
  $('#sheet').hidden = false;
  $('#sheet-scrim').hidden = false;
  if (!wasOpen) $('#sheet-body').scrollTop = 0;
  if (push && !wasOpen) history.pushState({ ...(history.state || {}), sheet: true }, '');
}

function closeSheet(pop = true) {
  if (!sheetKind) return;
  sheetKind = '';
  const sheet = $('#sheet');
  const scrim = $('#sheet-scrim');
  sheet.classList.add('closing');
  scrim.classList.add('closing');
  setTimeout(() => {
    if (sheetKind) return;
    sheet.hidden = true;
    scrim.hidden = true;
    sheet.classList.remove('closing');
    scrim.classList.remove('closing');
  }, 220);
  if (pop && history.state?.sheet) history.back();
}

const kv = (k, v, mono = false) => (v === '' || v == null ? '' : `<div class="kv"><dt>${esc(k)}</dt><dd${mono ? ' class="mono"' : ''}>${esc(v)}</dd></div>`);
const group = (title, body) => (body.trim() ? `<div class="info-group"><h4>${esc(title)}</h4><dl>${body}</dl></div>` : '');
const nf = (n) => Number(n).toLocaleString('en-US');

function fmtExact(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(3).padStart(6, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function fmtSize(b) {
  if (!b) return '';
  return b > 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

const TAG_GROUPS = [
  ['Tags', [
    ['TITLE', 'Title'], ['ARTIST', 'Artist'], ['ALBUMARTIST', 'Album artist'], ['ALBUM', 'Album'], ['SUBTITLE', 'Subtitle'],
    ['TRACKNUMBER', 'Track'], ['DISCNUMBER', 'Disc'], ['DISCSUBTITLE', 'Disc subtitle'], ['DATE', 'Date'],
    ['ORIGINALDATE', 'Original date'], ['RELEASEDATE', 'Release date'], ['GENRE', 'Genre'], ['GROUPING', 'Grouping'],
    ['MOOD', 'Mood'], ['LANGUAGE', 'Language'], ['MEDIA', 'Media'], ['COMPILATION', 'Compilation'], ['COMMENT', 'Comment'],
  ]],
  ['Nerd', [['BPM', 'BPM'], ['INITIALKEY', 'Key']]],
  ['Credits', [
    ['COMPOSER', 'Composer'], ['LYRICIST', 'Lyricist'], ['WRITER', 'Writer'], ['ARRANGER', 'Arranger'], ['CONDUCTOR', 'Conductor'],
    ['PRODUCER', 'Producer'], ['ENGINEER', 'Engineer'], ['MIXER', 'Mixer'], ['REMIXER', 'Remixer'], ['PERFORMER', 'Performer'],
    ['ORIGINALARTIST', 'Original artist'], ['LABEL', 'Label'], ['COPYRIGHT', 'Copyright'],
  ]],
  ['Loudness', [
    ['REPLAYGAIN_TRACK_GAIN', 'Track gain'], ['REPLAYGAIN_TRACK_PEAK', 'Track peak'], ['REPLAYGAIN_ALBUM_GAIN', 'Album gain'],
    ['REPLAYGAIN_ALBUM_PEAK', 'Album peak'], ['REPLAYGAIN_REFERENCE_LOUDNESS', 'Reference'], ['R128_TRACK_GAIN', 'R128 track gain'], ['R128_ALBUM_GAIN', 'R128 album gain'],
  ]],
  ['IDs', [['ISRC', 'ISRC'], ['BARCODE', 'Barcode'], ['CATALOGNUMBER', 'Catalog number'], ['ACOUSTID_ID', 'AcoustID']]],
  ['Encoding', [['ENCODER', 'Encoder'], ['ENCODEDBY', 'Encoded by'], ['ENCODINGTIME', 'Encoded on'], ['WEBSITE', 'Website']]],
];
const KNOWN = new Set(['TRACKTOTAL', 'DISCTOTAL', 'LYRICS', ...TAG_GROUPS.flatMap(([, list]) => list.map(([k]) => k))]);

function tagRows(m, list) {
  return list.map(([key, label]) => {
    const vals = m.tags[key];
    if (!vals) return '';
    let v = vals.join('\n');
    if (key === 'TRACKNUMBER' && m.tags.TRACKTOTAL) v += ` of ${m.tags.TRACKTOTAL[0]}`;
    if (key === 'DISCNUMBER' && m.tags.DISCTOTAL) v += ` of ${m.tags.DISCTOTAL[0]}`;
    if (key === 'COMPILATION') v = v === '1' ? 'Yes' : v;
    return kv(label, v);
  }).join('');
}

function openTrackInfo(id, push = true) {
  const t = lib?.tracksById[id];
  if (!t) return;
  const m = t.meta;
  let html = `
    <div class="info-hero">
      <span class="art" data-cover="${esc(t.cover)}" data-seed="${esc(t.album)}"></span>
      <div><b>${esc(t.title)}</b><small>${esc([t.artist, t.album].filter(Boolean).join(' · '))}</small>
      <span class="chips">${m && !m.error ? qualityChip(m) : ''}</span></div>
    </div>`;
  if (!m) {
    html += "<p class=\"info-note\">This song's info hasn't been read yet. It will show here once the library finishes reading.</p>";
  } else if (m.error) {
    html += `<p class="info-note">Couldn't read this file's info: ${esc(m.error)}</p>`;
  } else {
    const audio = [
      kv('Codec', m.codec || m.format),
      kv('Container', m.container),
      kv('Lossless', m.lossless ? (m.hiRes ? 'Yes · Hi-Res' : 'Yes') : 'No'),
      kv('Sample rate', m.sampleRate ? `${nf(m.sampleRate)} Hz` : ''),
      kv('Bit depth', m.bitDepth ? `${m.bitDepth}-bit` : ''),
      kv('Channels', m.channels ? `${m.channels} · ${m.channelMode}` : ''),
      kv('Bitrate', m.bitrate ? `${nf(m.bitrate)} kbps${m.bitrateMode ? ' · ' + m.bitrateMode : ''}` : ''),
      kv('Duration', fmtExact(m.duration)),
      kv('Samples', m.samples ? nf(m.samples) : ''),
      kv('Encoder', m.encoder),
      ...m.extra.map(([k, v]) => kv(k, v, /MD5/.test(k))),
    ].join('');
    html += group('Audio', audio);
    for (const [title, list] of TAG_GROUPS) html += group(title, tagRows(m, list));
    const mb = Object.keys(m.tags).filter((k) => k.startsWith('MUSICBRAINZ_'));
    html += group('MusicBrainz', mb.map((k) => kv(k.replace('MUSICBRAINZ_', '').replace(/ID$/, ' ID').toLowerCase(), m.tags[k].join('\n'), true)).join(''));
    const lyr = first(m, 'LYRICS');
    const lyrRows = [
      t.lrcId ? kv('.lrc file', 'Yes') : '',
      m.syncedLyrics?.length ? kv('SYLT', `${m.syncedLyrics.length} synced lines`) : '',
      lyr ? kv('Lyrics tag', `${lyr.split(/\n/).filter((x) => x.trim()).length} lines${/\[\d{1,2}:\d{2}/.test(lyr) ? ' · LRC timestamps' : ''}`) : '',
    ].join('');
    html += group('Lyrics', lyrRows);
    html += group('Artwork', m.pictures.map((p) => kv(p.typeName || 'Picture', [p.mime?.replace('image/', '').toUpperCase(), p.w && p.h ? `${p.w}×${p.h}` : '', fmtSize(p.len)].filter(Boolean).join(' · '))).join(''));
    const other = Object.keys(m.tags).filter((k) => !KNOWN.has(k) && !k.startsWith('MUSICBRAINZ_'));
    html += group('Other tags', other.map((k) => kv(k, m.tags[k].join('\n'))).join(''));
    const rawOnly = m.raw.filter(([k]) => /^[A-Z0-9]{4}$|^INFO |^----|^COMM:|^UFID|^iTun|^POPM|^[a-z©]/.test(k) && !KNOWN.has(k));
    html += group('Raw frames', rawOnly.slice(0, 40).map(([k, v]) => kv(k, v)).join(''));
    html += group('Tag', kv('Tag format', m.tagType));
  }
  html += group('File', [
    kv('Name', t.file), kv('Size', fmtSize(t.size)), kv('Folder', t.path),
    kv('Modified in Drive', t.modified ? new Date(t.modified).toLocaleString() : ''),
  ].join(''));
  openSheet('info', 'Song info', html, push);
  sheetTrackId = id;
}

function openAlbumInfo(key) {
  const a = lib?.albumsById[key];
  if (!a) return;
  const lossless = a.tracks.filter((t) => t.meta?.lossless).length;
  const hires = a.tracks.filter((t) => t.meta?.hiRes).length;
  const size = a.tracks.reduce((s, t) => s + (t.size || 0), 0);
  const formats = [...new Set(a.tracks.map((t) => t.meta ? `${t.meta.codec || t.meta.format} ${qualityTag(t.meta)}`.trim() : t.ext))];
  const html = `
    <div class="info-hero">
      <span class="art" data-cover="${esc(a.cover)}" data-seed="${esc(a.name)}"></span>
      <div><b>${esc(a.name)}</b><small>${esc(a.artist || '')}</small></div>
    </div>
    ${group('Album', [kv('Album', a.name), kv('Album artist', a.artist), kv('Year', a.year), kv('Genre', a.genre), kv('Label', a.label), kv('Copyright', a.copyright)].join(''))}
    ${group('Quality', [kv('Format', formats.join('\n')), kv('Lossless', `${lossless} of ${a.tracks.length}`), kv('Hi-Res', hires ? `${hires} of ${a.tracks.length}` : 'No')].join(''))}
    ${group('Size', [kv('Songs', a.tracks.length), kv('Discs', a.discs > 1 ? a.discs : ''), kv('Total time', a.duration ? fmtExact(a.duration).replace(/\.\d+$/, '') : ''), kv('Total size', fmtSize(size)), kv('Folder', a.tracks[0].path)].join(''))}`;
  openSheet('album', 'Album info', html);
}

function openQueue(push = true) {
  const s = player.state;
  const items = s.order.slice(s.pos + 1, s.pos + 101).map((qi, k) => {
    const t = s.queue[qi];
    return `<div class="row" role="button" tabindex="0" data-action="jump" data-pos="${s.pos + 1 + k}">
      <span class="art sm" data-seed="${esc(t.album)}" data-cover="${esc(t.cover)}"></span>
      <span class="row-text"><b>${esc(t.title)}</b><small>${esc([t.artist, t.album].filter(Boolean).join(' · '))}</small></span>
      <span class="row-end"><span class="dur">${t.duration ? fmt(t.duration) : ''}</span></span>
    </div>`;
  });
  const html = items.length ? `<div class="rows">${items.join('')}</div>`
    : `<p class="info-note first">${s.repeat === 'all' ? 'The queue will start again from the top.' : 'Nothing plays after this song.'}</p>`;
  openSheet('queue', 'Up next', html, push);
}

// ================= settings =================
function sourceRow(src) {
  const scan = scans[src.id];
  const st = srcState[src.id]?.status;
  const count = scan ? plural(scan.files.length, 'song') : '';
  const name = src.kind === 'local' ? src.name : (scan?.rootName || src.name || 'Drive folder');
  const where = src.kind === 'local' ? 'This PC' : (accountOf(src) || 'Google Drive');
  const status = st === 'scanning' ? 'Scanning…' : st === 'auth' ? 'Needs sign-in' : st === 'permission' ? 'Needs permission'
    : st === 'error' ? (srcState[src.id].error || 'Failed') : '';
  const actions = [
    st === 'permission' ? `<button class="pill-btn small light" type="button" data-set-action="allow" data-src="${esc(src.id)}">Allow</button>` : '',
    st === 'auth' ? `<button class="pill-btn small light" type="button" data-set-action="connect" data-account="${esc(accountOf(src))}">Connect</button>` : '',
    src.kind === 'drive' ? `<a class="round-btn sm" href="https://drive.google.com/drive/folders/${encodeURIComponent(src.folderId)}" target="_blank" rel="noopener" aria-label="Open in Drive" title="Open in Drive">${ICON.chevron}</a>` : '',
    src.isDefault ? '<span class="badge-default">Default</span>'
      : `<button class="pill-btn small danger" type="button" data-set-action="remove" data-src="${esc(src.id)}">Remove</button>`,
  ].join('');
  return `<div class="set-row src-row">
    <span class="src-icon">${src.kind === 'local' ? ICON.pc : ICON.drive}</span>
    <span class="src-text"><b>${esc(name)}</b><small>${esc([where, count, status].filter(Boolean).join(' · '))}</small></span>
    <span class="src-actions">${actions}</span>
  </div>`;
}

function toggleRow(key, label, hint) {
  return `<label class="set-row">
    <span><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
    <input type="checkbox" class="switch" data-set="${key}" ${settings[key] ? 'checked' : ''}>
  </label>`;
}

async function openSettings(push = true) {
  const rg = settings.replayGain;
  const html = `
    <div class="info-group set-group">
      <h4>Music sources</h4>
      ${listSources().map(sourceRow).join('')}
      <div class="set-buttons">
        <button class="pill-btn small" type="button" data-set-action="refresh">Refresh all</button>
        <button class="pill-btn small" type="button" data-set-action="rescan">Re-read all song info</button>
      </div>
    </div>

    <div class="info-group set-group">
      <h4>Add a source <span class="h4-note">${listSources().length - 1} of ${MAX_EXTRA} extra</span></h4>
      ${canAddSource() ? `
      <form class="set-form" data-form="add-drive">
        <label for="add-drive-link" class="set-label">${ICON.drive} Google Drive folder (paste its link)</label>
        <input id="add-drive-link" class="set-input" type="text" placeholder="https://drive.google.com/drive/folders/…" autocomplete="off">
        <div class="set-inline">
          <select id="add-drive-account" class="set-input" aria-label="Google account">
            ${knownAccounts().map((a) => `<option value="${esc(a)}">${esc(a)}${a === primaryAccount() ? ' (main)' : ''}</option>`).join('')}
            <option value="__other__">Another Google account…</option>
          </select>
          <button class="pill-btn small" type="submit">Add</button>
        </div>
      </form>
      <div class="set-row">
        <span><b>${ICON.pc} Folder on this PC</b><small>${localSupported() ? 'Pick it once. The app remembers it.' : 'Works in Chrome or Edge on a computer.'}</small></span>
        <button class="pill-btn small" type="button" data-set-action="add-local" ${localSupported() ? '' : 'disabled'}>Choose folder</button>
      </div>` : `<p class="info-note pad">You've reached ${MAX_EXTRA} extra sources. Remove one to add another.</p>`}
      <form class="set-form" data-form="folder">
        <label for="folder-input" class="set-label">Change the default Drive folder</label>
        <div class="set-inline">
          <input id="folder-input" class="set-input" type="text" placeholder="https://drive.google.com/drive/folders/…" autocomplete="off">
          <button class="pill-btn small" type="submit">Use</button>
        </div>
        ${settings.folderId ? '<button class="text-btn" type="button" data-set-action="folder-reset">Go back to the original folder</button>' : ''}
      </form>
    </div>

    <div class="info-group set-group">
      <h4>Playback</h4>
      <div class="set-row col">
        <span><b>Volume normalization</b><small>Uses ReplayGain tags so quiet and loud songs play at a similar level.</small></span>
        <div class="seg small" role="radiogroup" aria-label="Volume normalization">
          ${['off', 'track', 'album'].map((v) => `<button type="button" role="radio" aria-checked="${rg === v}" class="${rg === v ? 'on' : ''}" data-rg="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="info-group set-group">
      <h4>Display</h4>
      ${toggleRow('dynamicColor', 'Colors from album art', 'Tint screens with each cover’s colors.')}
      ${toggleRow('showTech', 'Technical line', 'Codec, bitrate, sample rate and bit depth on Now Playing.')}
      ${toggleRow('lyricsPreview', 'Lyric preview', 'Current lyric line under the song title.')}
    </div>

    <div class="info-group set-group">
      <h4>Storage</h4>
      <div class="set-row"><span><b>Saved on this device</b><small id="storage-info">Counting…</small></span>
        <button class="pill-btn small" type="button" data-set-action="clear">Clear</button></div>
    </div>

    <div class="info-group set-group">
      <h4>Account</h4>
      ${knownAccounts().map((a) => `<div class="set-row"><span><b>${esc(accountName(a) || a)}${a === primaryAccount() ? ' · main' : ''}</b><small>${esc(a)} · ${canWrite(a) ? 'read and upload' : hasToken(a) ? 'read only' : 'signed out'}</small></span>${hasToken(a) ? '' : `<button class="pill-btn small" type="button" data-set-action="connect" data-account="${esc(a)}">Connect</button>`}</div>`).join('') || '<div class="set-row"><span><b>Google Drive</b><small>Not connected</small></span></div>'}
      ${installPrompt ? '<div class="set-row"><span><b>Install app</b><small>Add N4cuply to your home screen.</small></span><button class="pill-btn small" type="button" data-set-action="install">Install</button></div>' : ''}
      <div class="set-row"><span><b>Log out</b><small>Signs out and clears saved data on this device.</small></span>
        <button class="pill-btn small danger" type="button" data-set-action="logout">Log out</button></div>
    </div>
    <p class="info-note center">N4cuply ${APP_VERSION} · ${plural(allFiles().length, 'song')} from ${plural(listSources().length, 'source')}</p>`;
  openSheet('settings', 'Settings', html, push);
  const [meta, covers] = await Promise.all([idbGetAll('meta'), idbGetAll('covers')]);
  let bytes = 0;
  for (const c of covers.values()) bytes += c?.blob?.size || 0;
  const el = $('#storage-info');
  if (el) el.textContent = `Info for ${plural(meta.size, 'song')} · ${plural(covers.size, 'cover')} (${fmtSize(bytes) || '0 KB'})`;
}

function onSettingsEvent(e) {
  if (sheetKind !== 'settings') return;
  const sw = e.target.closest('[data-set]');
  if (sw) {
    if (e.type === 'change') {
      setSetting(sw.dataset.set, sw.checked);
      applyDisplaySettings();
    }
    return;
  }
  if (e.type !== 'click') return;
  const rg = e.target.closest('[data-rg]');
  if (rg) {
    setSetting('replayGain', rg.dataset.rg);
    player.setReplayGain(rg.dataset.rg);
    openSettings(false);
    return;
  }
  const act = e.target.closest('[data-set-action]')?.dataset.setAction;
  if (!act) return;
  if (act === 'refresh') { withAuth(() => refreshLibrary()); toast('Refreshing your library…'); }
  if (act === 'rescan') withAuth(() => { resetLibrary(); closeSheet(); refreshLibrary(); });
  if (act === 'upload') openUpload(undefined, false);
  if (act === 'clear') { resetLibrary(); closeSheet(); toast('Cleared. Song info will be read again.'); withAuth(() => refreshLibrary()); }
  if (act === 'allow') allowLocal(e.target.closest('[data-src]').dataset.src).then(() => openSettings(false));
  if (act === 'connect') reconnect(e.target.closest('[data-account]').dataset.account).then(() => openSettings(false));
  if (act === 'remove') {
    const id = e.target.closest('[data-src]').dataset.src;
    removeSource(id);
    delete scans[id];
    delete srcState[id];
    rebuild();
    render();
    openSettings(false);
    toast('Source removed. Its files are untouched.');
  }
  if (act === 'add-local') addLocal();
  if (act === 'folder-reset') { setSetting('folderId', ''); switchFolder(); }
  if (act === 'install' && installPrompt) { installPrompt.prompt(); installPrompt = null; openSettings(false); }
  if (act === 'logout') logout();
}

function resetLibrary() {
  clearCache();
  for (const id of Object.keys(scans)) delete scans[id];
  lib = null;
}

async function addLocal() {
  try {
    const handle = await window.showDirectoryPicker({ id: 'my-player-music', mode: 'read' });
    const src = await addLocalSource(handle);
    toast(`Added "${src.name}". Scanning…`);
    openSettings(false);
    await refreshLibrary({ quiet: true, only: src.id });
    openSettings(false);
  } catch (e) {
    if (e?.name !== 'AbortError') toast(e.message || "Couldn't add that folder.");
  }
}

async function addDrive(link, accountChoice) {
  const folderId = parseFolderInput(link);
  if (!folderId) { toast("That doesn't look like a Drive folder link."); return; }
  try {
    let account = accountChoice;
    if (account === '__other__') account = await signIn({ choose: true });
    else if (!hasToken(account)) await signIn({ account });
    const folder = await getFolder(folderId, account);
    const src = addDriveSource({ folderId, account: account === primaryAccount() ? '' : account, name: folder.name });
    toast(`Added "${folder.name}". Scanning…`);
    openSettings(false);
    await refreshLibrary({ quiet: true, only: src.id });
    openSettings(false);
  } catch (e) {
    toast(e.message || "Couldn't add that folder.");
  }
}

function onSettingsSubmit(e) {
  const add = e.target.closest('[data-form="add-drive"]');
  if (add) {
    e.preventDefault();
    addDrive($('#add-drive-link').value, $('#add-drive-account').value);
    return;
  }
  const form = e.target.closest('[data-form="folder"]');
  if (!form) return;
  e.preventDefault();
  const id = parseFolderInput($('#folder-input').value);
  if (!id) { toast("That doesn't look like a Drive folder link."); return; }
  setSetting('folderId', id);
  switchFolder();
}

function switchFolder() {
  closeSheet();
  delete scans.default;
  location.hash = '';
  withAuth(() => refreshLibrary());
}

function applyDisplaySettings() {
  player.setReplayGain(settings.replayGain);
  $('#now').dataset.cover = '';
  if (player.current()) updatePlayerUi();
  updateLyricPreview();
  render();
}

// ================= upload =================
const upload = { items: [], busy: false, folder: '' };
const UPLOAD_RE = /\.(mp3|m4a|m4b|mp4|aac|alac|wav|ogg|oga|opus|flac|webm|lrc|jpe?g|png|webp)$/i;

function addUploadFiles(fileList) {
  const all = [...fileList];
  const files = all.filter((f) => UPLOAD_RE.test(f.name) || f.type.startsWith('audio/'));
  const skipped = all.length - files.length;
  for (const f of files) upload.items.push({ file: f, status: 'ready', progress: 0, error: '' });
  if (skipped) toast(`Skipped ${plural(skipped, 'file')} that isn't audio, .lrc or an image.`);
}

const driveSources = () => listSources().filter((src) => src.kind === 'drive' && scans[src.id]);

function uploadTarget(folderId) {
  for (const src of driveSources()) if (scans[src.id].folders[folderId]) return src;
  return null;
}

function openUpload(folderId, push = true) {
  if (folderId !== undefined) upload.folder = uploadTarget(folderId) ? folderId : '';
  const rootId = scans.default?.rootId || driveSources()[0] && scans[driveSources()[0].id].rootId || '';
  const ready = upload.items.filter((i) => i.status === 'ready').length;
  const selected = upload.folder || rootId;
  const sel = selected;
  const html = `
    ${driveSources().some((src) => !canWrite(accountOf(src))) ? '<p class="info-note first">Uploading needs permission to add files to your Google Drive. Google will ask you once when you start.</p>' : ''}
    <div class="drop-zone" data-up="pick" role="button" tabindex="0">
      ${ICON.upload}
      <b>Choose files</b>
      <small>or drag them here · FLAC, MP3, M4A, WAV, OGG, .lrc lyrics, cover images</small>
    </div>
    <label class="set-label" for="up-folder">Upload to</label>
    <select id="up-folder" class="set-input">
      ${driveSources().map((src) => {
        const sc = scans[src.id];
        const folders = Object.values(sc.folders).sort((a, b) => a.path.localeCompare(b.path));
        return `<optgroup label="${esc(sc.rootName)}${src.account ? ' · ' + esc(src.account) : ''}">
          ${folders.map((f) => `<option value="${esc(f.id)}" ${sel === f.id ? 'selected' : ''}>${esc(f.path)}</option>`).join('')}
          <option value="__new__:${esc(src.id)}" ${sel === '__new__:' + src.id ? 'selected' : ''}>New album folder in ${esc(sc.rootName)}…</option>
        </optgroup>`;
      }).join('')}
    </select>
    <input id="up-new" class="set-input" type="text" placeholder="New folder name (for example the album title)" ${sel.startsWith('__new__') ? '' : 'hidden'}>
    <p class="info-note">Uploads go to Google Drive. PC folders can't be uploaded to.</p>
    <div class="up-list">${upload.items.map((it, i) => uploadRow(it, i)).join('')}</div>
    <div class="set-buttons">
      <button class="pill-btn light" type="button" data-up="start" ${!ready || upload.busy ? 'disabled' : ''}>${upload.busy ? 'Uploading…' : ready ? `Upload ${plural(ready, 'file')}` : 'Upload'}</button>
      ${upload.items.length && !upload.busy ? '<button class="pill-btn" type="button" data-up="clear">Clear list</button>' : ''}
    </div>`;
  openSheet('upload', 'Upload songs', html, push);
}

function uploadRow(it, i) {
  const status = it.status === 'done' ? 'Uploaded' : it.status === 'error' ? it.error : it.status === 'uploading' ? `${Math.round(it.progress * 100)}%` : fmtSize(it.file.size);
  return `<div class="up-row ${it.status}" id="up-${i}">
    <span class="up-name">${esc(it.file.name)}</span>
    <span class="up-status">${esc(status)}</span>
    ${it.status === 'ready' ? `<button class="more" type="button" data-up="remove" data-i="${i}" aria-label="Remove ${esc(it.file.name)}">${ICON.close}</button>` : ''}
    <div class="up-bar"><i style="width:${(it.progress * 100).toFixed(1)}%"></i></div>
  </div>`;
}

function refreshUploadRow(i) {
  const el = document.getElementById('up-' + i);
  if (el) el.outerHTML = uploadRow(upload.items[i], i);
}

function onUploadEvent(e) {
  if (sheetKind !== 'upload') return;
  if (e.type === 'change' && e.target.id === 'up-folder') {
    upload.folder = e.target.value;
    $('#up-new').hidden = !upload.folder.startsWith('__new__');
    return;
  }
  if (e.type !== 'click') return;
  const btn = e.target.closest('[data-up]');
  if (!btn) return;
  const act = btn.dataset.up;
  if (act === 'pick') $('#file-input').click();
  if (act === 'remove') { upload.items.splice(Number(btn.dataset.i), 1); openUpload(undefined, false); }
  if (act === 'clear') { upload.items = []; openUpload(undefined, false); }
  if (act === 'start') startUpload();
}

function startUpload() {
  if (upload.busy) return;
  const target = $('#up-folder')?.value || '';
  const newName = $('#up-new')?.value.trim();
  if (!target) { toast('No Drive folder to upload to yet.'); return; }
  const isNew = target.startsWith('__new__:');
  if (isNew && !newName) { toast('Type a name for the new folder.'); return; }
  const src = isNew ? sourceById(target.slice(8)) : uploadTarget(target);
  if (!src) { toast('Pick a Drive folder to upload to.'); return; }
  const account = accountOf(src);
  const run = async () => {
    upload.busy = true;
    if (sheetKind === 'upload') openUpload(undefined, false);
    let parent = target;
    try {
      if (isNew) {
        const f = await createFolder(newName, scans[src.id].rootId, account);
        parent = f.id;
        upload.folder = f.id;
      }
    } catch (e) {
      upload.busy = false;
      toast(`Couldn't create the folder: ${e.message}`);
      if (sheetKind === 'upload') openUpload(undefined, false);
      return;
    }
    let ok = 0;
    for (let i = 0; i < upload.items.length; i++) {
      const it = upload.items[i];
      if (it.status !== 'ready') continue;
      it.status = 'uploading';
      refreshUploadRow(i);
      try {
        await uploadFile(it.file, parent, account, (p) => {
          it.progress = p;
          const bar = document.querySelector(`#up-${i} .up-bar i`);
          const st = document.querySelector(`#up-${i} .up-status`);
          if (bar) bar.style.width = (p * 100).toFixed(1) + '%';
          if (st) st.textContent = `${Math.round(p * 100)}%`;
        });
        it.status = 'done';
        it.progress = 1;
        ok++;
      } catch (e) {
        it.status = 'error';
        it.error = e.message;
        refreshUploadRow(i);
        if (e instanceof AuthError) break;
        continue;
      }
      refreshUploadRow(i);
    }
    upload.busy = false;
    if (sheetKind === 'upload') openUpload(undefined, false);
    if (ok) {
      toast(`Uploaded ${plural(ok, 'file')}. Updating your library…`);
      refreshLibrary({ quiet: true, only: src.id });
    }
  };
  if (canWrite(account) && !expiresSoon(account)) run();
  else signIn({ write: true, account }).then(run).catch((e) => toast(e.message));
}

function wireDragDrop() {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || $('#app').hidden) return;
    depth++;
    $('#drop').hidden = false;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) $('#drop').hidden = true;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('#drop').hidden = true;
    if ($('#app').hidden) return;
    addUploadFiles(e.dataTransfer.files);
    const r = route();
    const folder = r.name === 'album' && lib?.albumsById[r.id] ? lib.albumsById[r.id].folderId : undefined;
    openUpload(folder, sheetKind !== 'upload');
  });
}

// ================= events =================
function wireStaticUi() {
  $('#connect').addEventListener('click', connect);
  $('#q').addEventListener('input', () => render());

  const onAction = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'track-info') { e.stopPropagation(); openTrackInfo(el.dataset.id); return; }
    const list = lists[el.dataset.list] || [];
    if (action === 'play-track') withAuth(() => player.playList(list, Number(el.dataset.i), { shuffle: player.state.shuffle }));
    else if (action === 'play-list') withAuth(() => player.playList(list, 0, { shuffle: false }));
    else if (action === 'shuffle-list') withAuth(() => player.playList(list, 0, { shuffle: true, randomStart: true }));
    else if (action === 'back') history.length > 1 ? history.back() : (location.hash = '');
    else if (action === 'album-info') openAlbumInfo(el.dataset.key);
    else if (action === 'refresh') withAuth(() => refreshLibrary());
    else if (action === 'allow-local') allowLocal(el.dataset.src);
    else if (action === 'connect') reconnect(el.dataset.account || '');
    else if (action === 'settings') openSettings();
    else if (action === 'upload') openUpload(el.dataset.folder || undefined);
    else if (action === 'jump') withAuth(() => player.jumpTo(Number(el.dataset.pos)));
  };
  $('#main').addEventListener('click', onAction);
  const body = $('#sheet-body');
  body.addEventListener('click', onAction);
  body.addEventListener('click', onSettingsEvent);
  body.addEventListener('change', onSettingsEvent);
  body.addEventListener('submit', onSettingsSubmit);
  body.addEventListener('click', onUploadEvent);
  body.addEventListener('change', onUploadEvent);
  body.addEventListener('click', (e) => {
    const line = e.target.closest('.ly');
    if (line && sheetKind === 'lyrics') {
      player.seek(Number(line.dataset.t));
      userScrolledAt = 0;
    }
  });
  for (const ev of ['wheel', 'touchmove']) {
    body.addEventListener(ev, () => { if (sheetKind === 'lyrics') userScrolledAt = Date.now(); }, { passive: true });
  }
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.row[role="button"], .ly, .drop-zone')) {
      e.preventDefault();
      e.target.click();
    }
  });

  $('#file-input').addEventListener('change', (e) => {
    addUploadFiles(e.target.files);
    e.target.value = '';
    openUpload(undefined, sheetKind !== 'upload');
  });
  $('#upload-btn').addEventListener('click', () => {
    const r = route();
    openUpload(r.name === 'album' && lib?.albumsById[r.id] ? lib.albumsById[r.id].folderId : undefined);
  });
  $('#settings-btn').addEventListener('click', () => openSettings());
  wireDragDrop();

  $('#mini-open').addEventListener('click', () => setNowOpen(true));
  $('#np-close').innerHTML = ICON.down;
  $('#np-close').addEventListener('click', () => setNowOpen(false));
  $('#np-more').innerHTML = ICON.more;
  $('#np-info').innerHTML = ICON.info;
  const infoCurrent = () => { const t = player.current(); if (t) openTrackInfo(t.id); };
  $('#np-more').addEventListener('click', infoCurrent);
  $('#np-info').addEventListener('click', infoCurrent);
  $('#np-artist').addEventListener('click', () => {
    const t = player.current();
    const name = t?.albumArtist || t?.artist;
    if (name && lib.artists.find((a) => a.name === name)) {
      setNowOpen(false);
      setTimeout(() => { location.hash = 'artist/' + encodeURIComponent(name); }, 50);
    }
  });
  $('#np-lyric').addEventListener('click', () => openLyrics());
  $('#c-lyrics').innerHTML = ICON.lyrics;
  $('#c-lyrics').addEventListener('click', () => openLyrics());
  $('#c-queue').innerHTML = ICON.queue;
  $('#c-queue').addEventListener('click', () => openQueue());
  $('#mini-next').innerHTML = ICON.next;
  $('#c-next').innerHTML = ICON.next;
  $('#c-prev').innerHTML = ICON.prev;
  $('#sheet-close').innerHTML = ICON.close;
  $('#sheet-close').addEventListener('click', () => closeSheet());
  $('#sheet-scrim').addEventListener('click', () => closeSheet());

  $('#mini-play').addEventListener('click', () => withAuth(() => player.toggle()));
  $('#c-play').addEventListener('click', () => withAuth(() => player.toggle()));
  $('#mini-next').addEventListener('click', () => withAuth(() => player.next()));
  $('#c-next').addEventListener('click', () => withAuth(() => player.next()));
  $('#c-prev').addEventListener('click', () => withAuth(() => player.prev()));
  $('#c-shuffle').addEventListener('click', () => player.setShuffle(!player.state.shuffle));
  $('#c-repeat').addEventListener('click', () => player.cycleRepeat());

  const seek = $('#seek');
  seek.addEventListener('input', () => { seeking = true; updateTime(); });
  seek.addEventListener('change', () => {
    const d = player.audio.duration || player.current()?.duration;
    if (d) player.seek((seek.value / 1000) * d);
    seeking = false;
  });

  const vol = $('#volume');
  vol.value = settings.volume;
  player.setVolume(settings.volume / 100);
  player.setReplayGain(settings.replayGain);
  vol.style.setProperty('--pct', settings.volume + '%');
  vol.addEventListener('input', () => {
    player.setVolume(vol.value / 100);
    vol.style.setProperty('--pct', vol.value + '%');
    setSetting('volume', Number(vol.value));
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) {
      if (e.key === 'Escape' && e.target.id === 'q') { $('#q').value = ''; render(); $('#q').blur(); }
      return;
    }
    if (e.key === ' ' && !e.target.matches?.('.row[role="button"], button, .ly, .drop-zone')) { e.preventDefault(); withAuth(() => player.toggle()); }
    else if (e.key === 'Escape') { if (sheetKind) closeSheet(); else if (nowOpen) setNowOpen(false); }
    else if (e.key === 'ArrowRight' && e.shiftKey) player.next();
    else if (e.key === 'ArrowLeft' && e.shiftKey) player.prev();
  });

  $('.brand').addEventListener('click', (e) => { e.preventDefault(); $('#q').value = ''; location.hash = ''; render(); });
}

/**
 * Runs fn when we have a token. Otherwise opens the Google popup inside this
 * click and runs fn after sign-in.
 */
function withAuth(fn) {
  if (hasToken() && !expiresSoon()) return fn();
  if (hasToken()) {
    if (Date.now() - lastRefreshTry > 5 * 60e3) {
      lastRefreshTry = Date.now();
      signIn().catch(() => {});
    }
    return fn();
  }
  signIn().then(() => { hideToast(); fn(); }).catch((e) => toast(e.message));
}


function logout() {
  player.audio.pause();
  signOut();
  clearCache();
  try { localStorage.removeItem('mp.player.v1'); } catch (e) { /* ignore */ }
  location.hash = '';
  location.reload();
}

// ================= toast =================
let toastTimer = 0;
function toast(message, { action, onAction } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').addEventListener('click', onAction, { once: true });
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(hideToast, 3500);
}

function hideToast() {
  $('#toast').hidden = true;
}

player.on('change', updatePlayerUi);
player.on('state', () => { updatePlayState(); if (player.state.playing) progressLoop(); });
player.on('time', updateTime);
player.on('auth', (e) => {
  const t = e.detail || {};
  if (t.mode === 'local-permission') {
    toast(`Allow access to "${t.src.name}" to play this song.`, { action: 'Allow', onAction: () => allowLocal(t.src.id) });
  } else {
    const account = t.account || primaryAccount();
    toast(account && account !== primaryAccount() ? `Connect ${account} to play this song.` : 'Session expired. Connect again to keep playing.',
      { action: 'Connect', onAction: () => reconnect(account) });
  }
});
player.on('error', (e) => toast(e.detail));

boot();
