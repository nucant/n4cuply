import {
  initAuth, hasToken, canWrite, expiresSoon, signIn, signOut, primaryAccount, accountName, knownAccounts,
} from './js/auth.js';
import { AuthError, uploadFile, createFolder, getFolder, updateFileContent } from './js/drive.js';
import {
  scanSource, loadScanCache, clearCache, loadMetaCache, missingMeta, readMissingMeta, build, refFor, LocalPermissionError,
} from './js/library.js';
import {
  listSources, sourceById, accountOf, addDriveSource, addLocalSource, removeSource, canAddSource, MAX_EXTRA,
  localSupported, localPermission, requestLocal, readBlob, saveToFolder, requestLocalWrite, overwriteFile,
} from './js/sources.js';
import {
  analyze, mergeArtists, mergeAlbums, ignore, resetRules, getRules, adoptRules, onRulesChange, RULES_FILE,
  setTrackFix, setTrackFixes, clearTrackFix, trackKeyOf, rekeyTrack,
  isLiked, toggleLike, playlists, createPlaylist, addToPlaylist, removeFromPlaylist, renamePlaylist, deletePlaylist,
} from './js/organize.js';
import { analyzeAudio } from './js/analyze.js';
import {
  findLyrics, findCover, findSongMatches, searchTermFor, isConfident,
} from './js/online.js';
import { first, techLine, qualityBadge, qualityTag, RangeReader, readMeta } from './js/meta.js';
import { writeTags, canWriteTags } from './js/tagwrite.js';
import { artistInfo, peekArtist, artistKnown, warmArtists } from './js/artists.js';
import { loadCover, peekCover, applyTint } from './js/covers.js';
import { lyricsFor, activeLine } from './js/lyrics.js';
import { settings, setSetting, parseFolderInput } from './js/settings.js';
import { idbGetAll } from './js/store.js';
import { player } from './js/player.js';

const APP_VERSION = '1.7';
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
  wand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20L15 9M14 4v3M19 9h3M17.5 5.5l2-2M12 6.5l1.5 1.5M16 11l1.5 1.5"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-9.2-9.3C1.7 7.4 4 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.8 1.3-1.7 2.9-2.8 4.9-2.8 3.1 0 5.4 2.9 4.3 6.2C19.5 15.4 12 20 12 20z"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M12 20s-7.5-4.6-9.2-9.3C1.7 7.4 4 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.8 1.3-1.7 2.9-2.8 4.9-2.8 3.1 0 5.4 2.9 4.3 6.2C19.5 15.4 12 20 12 20z"/></svg>',
  playNext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M4 11h10M4 16h6"/><path class="fill" d="M15 12.5v8l6-4z"/></svg>',
  album: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
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

let queuedRefresh = null;
async function refreshLibrary({ quiet = false, only = '' } = {}) {
  if (scanning) {
    // Run again when the current scan ends (after an edit or upload).
    queuedRefresh = queuedRefresh ? { quiet: queuedRefresh.quiet && quiet, only: queuedRefresh.only === only ? only : '' } : { quiet, only };
    return;
  }
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
  if (queuedRefresh) {
    const next = queuedRefresh;
    queuedRefresh = null;
    return refreshLibrary(next);
  }
  if (hasScans()) {
    pullRules();
    runMetaScan();
  }
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
  if ((m = h.match(/^playlist\/(.+)$/))) return { name: 'playlist', id: decodeURIComponent(m[1]) };
  if (h === 'songs' || h === 'artists' || h === 'playlists') return { name: h };
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
  else if (r.name === 'playlist') html = renderPlaylist(r.id);
  else html = renderHome(['album', 'artist', 'playlist'].includes(r.name) ? 'albums' : r.name);
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
        <a href="#playlists" class="${tab === 'playlists' ? 'on' : ''}">Playlists</a>
      </nav>
      <div class="home-actions">
        <button class="pill-btn light" type="button" data-action="play-list" data-list="all">${ICON.play}<span>Play all</span></button>
        <button class="pill-btn" type="button" data-action="shuffle-list" data-list="all">${ICON.shuffle}<span>Shuffle</span></button>
        <button class="pill-btn narrow-icon" type="button" data-action="upload" aria-label="Upload">${ICON.upload}<span>Upload</span></button>
        <button class="pill-btn narrow-icon" type="button" data-action="organize" aria-label="Organize">${ICON.wand}<span>Organize</span></button>
      </div>
      ${scanBarHtml()}
    </section>`;
  if (tab === 'songs') {
    return head + `<section class="section"><div class="rows">${lib.tracks.map((t, i) => songRow(t, 'all', i, { showArt: true })).join('')}</div></section>`;
  }
  if (tab === 'artists') {
    // Look each artist up once per session; never loop on artists without a photo.
    const missing = lib.artists.filter((a) => !artistKnown(a.name) && !artistsTried.has(a.name));
    if (missing.length) {
      for (const a of missing) artistsTried.add(a.name);
      warmArtists(missing.map((a) => a.name)).then(() => {
        if (settings.artistInfo) missing.filter((a) => !peekArtist(a.name)).forEach((a) => loadArtistInfo(a.name, true));
        render();
      });
    }
    return head + `<section class="section"><div class="artist-list">${lib.artists.map(artistCard).join('')}</div></section>`;
  }
  if (tab === 'playlists') return head + renderPlaylists();
  return head + shelvesHtml() + `<section class="section">${lib.albums.length > 4 && (recent.length || Object.keys(plays).length) ? '<h2 class="section-title">All albums</h2>' : ''}<div class="grid">${lib.albums.map(albumCard).join('')}</div></section>`;
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
  const info = peekArtist(ar.name);
  if (!info && !artistFetching.has(ar.name) && !artistsTried.has(ar.name)) {
    artistsTried.add(ar.name);
    loadArtistInfo(ar.name, settings.artistInfo);
  }
  const byAlbum = ar.tracks.slice().sort((x, y) => x.album.localeCompare(y.album) || x.discNo - y.discNo || x.n - y.n);
  lists.artist = byAlbum;
  lists.popular = ar.tracks.slice().sort((x, y) => (plays[y.key] || 0) - (plays[x.key] || 0) || (x.n || 99) - (y.n || 99)).slice(0, 5);
  const photo = artistPhoto(ar.name);
  const total = ar.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const lossless = ar.tracks.filter((t) => t.meta?.lossless).length;
  const about = info
    ? `<div class="about">
        ${info.thumb ? `<img src="${esc(info.thumb)}" alt="" class="about-img" loading="lazy">` : ''}
        <div class="about-text">
          ${info.description ? `<p class="about-desc">${esc(info.description)}</p>` : ''}
          <p class="about-bio" id="about-bio">${esc(info.bio)}</p>
          <div class="about-links"><button class="text-btn" type="button" data-action="bio-more">Read more</button>
          ${info.url ? `<a class="text-btn" href="${esc(info.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</div>
        </div>
      </div>`
    : artistFetching.has(ar.name) ? `<div class="about muted">Loading bio…</div>`
      : `<div class="about muted"><span>No bio yet.</span><button class="pill-btn small" type="button" data-action="artist-bio" data-name="${esc(ar.name)}">Get photo &amp; bio from Wikipedia</button></div>`;
  return `
    <div class="page artist-page" data-tint="${esc(photo || ar.cover)}" data-seed="${esc(ar.name)}">
      <header class="artist-top">
        <div class="art artist-blur" data-cover="${esc(photo || ar.cover)}" data-seed="${esc(ar.name)}" aria-hidden="true"></div>
        <div class="art artist-photo" data-cover="${esc(photo || ar.cover)}" data-seed="${esc(ar.name)}"></div>
        <div class="artist-shade"></div>
        <div class="page-top"><button class="round-btn" type="button" data-action="back" aria-label="Back">${ICON.back}</button><span></span></div>
        <div class="artist-name">
          <p class="eyebrow">Artist</p>
          <h1>${esc(ar.name)}</h1>
          <p class="hero-meta">${plural(ar.tracks.length, 'song')} · ${plural(ar.albums.length, 'album')}${total ? ' · ' + fmtTotal(total) : ''}${lossless ? ` · ${lossless} lossless` : ''}</p>
        </div>
      </header>
      <div class="artist-actions">
        <button class="play-fab" type="button" data-action="play-list" data-list="popular" aria-label="Play">${ICON.play}</button>
        <button class="round-btn" type="button" data-action="shuffle-list" data-list="artist" aria-label="Shuffle">${ICON.shuffle}</button>
      </div>
      <section class="section"><h2 class="section-title">Popular</h2><div class="rows">${lists.popular.map((t, i) => songRow(t, 'popular', i, { showArt: true, hideArtist: true })).join('')}</div></section>
      <section class="section"><h2 class="section-title">Albums</h2><div class="grid">${ar.albums.map(albumCard).join('')}</div></section>
      <section class="section"><h2 class="section-title">About</h2>${about}</section>
      ${ar.tracks.length > 5 ? `<section class="section"><h2 class="section-title">All songs</h2><div class="rows">${byAlbum.map((t, i) => songRow(t, 'artist', i, { showArt: true, hideArtist: true })).join('')}</div></section>` : ''}
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
      <div class="art" data-cover="${esc(artistPhoto(ar.name) || ar.cover)}" data-seed="${esc(ar.name)}"></div>
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

function songRow(t, list, i, { number = false, showArt = false, hideArtist = false, playlistId = '' } = {}) {
  const sub = [hideArtist ? '' : t.artist, list === 'album' ? '' : t.album].filter(Boolean).join(' · ');
  return `
    <div class="row" role="button" tabindex="0" data-action="play-track" data-list="${list}" data-i="${i}" data-id="${esc(t.id)}">
      ${number ? `<span class="num">${t.n}</span>` : showArt ? `<span class="art sm" data-cover="${esc(t.cover)}" data-seed="${esc(t.album)}"></span>` : ''}
      <span class="row-text"><b>${esc(t.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <span class="row-end">
        ${t.meta && !t.meta.error ? qualityChip(t.meta) : `<span class="q">${esc(t.ext)}</span>`}
        <span class="dur">${t.duration ? fmt(t.duration) : ''}</span>
        <button class="more fix" type="button" data-action="fix-track" data-id="${esc(t.id)}" aria-label="Fix info and cover" title="Fix info & cover">${ICON.wand}</button>
        <button class="more" type="button" data-action="song-menu" data-id="${esc(t.id)}" data-playlist="${esc(playlistId)}" aria-label="More">${ICON.more}</button>
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

  const lyricKey = `${t.id}:${t.lrcId}:${t.meta?.v || 0}:${settings.onlineLookup}`;
  if (lyricsTrackId !== lyricKey) {
    lyricsTrackId = lyricKey;
    currentLyrics = null;
    lastLyricIdx = -2;
    updateLyricPreview();
    lyricsFor(t, loadText, { online: settings.onlineLookup }).then((ly) => {
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
  if (sheetKind === 'info' && sheetTrackId === t.id && !$('#analysis .spectro')) openTrackInfo(t.id, false);
  updateLikeButton();
  markPlaying();
  updatePlayState();
}

function updateLikeButton() {
  const t = player.current();
  const on = !!t && isLiked(t.key);
  const btn = $('#np-like');
  btn.innerHTML = on ? ICON.heartFill : ICON.heart;
  btn.classList.toggle('liked', on);
  btn.setAttribute('aria-label', on ? 'Remove from Liked songs' : 'Add to Liked songs');
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
  countPlay(player.current(), a.currentTime);
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
      </div><p class="ly-source">Synced · ${esc(ly.source)} · tap a line to jump to it</p>${saveLyricsButton(ly)}`;
  } else {
    html = `<div class="lyrics">${esc(ly.lines.map((l) => l.text).join('\n').trim())}</div>
      <p class="ly-source">Not synced · ${esc(ly.source)}. Use an .lrc file with timestamps to sync.</p>${saveLyricsButton(ly)}`;
  }
  openSheet('lyrics', t.title, html, push);
  $('#sheet').classList.add('lyrics-sheet');
  lastLyricIdx = -2;
  syncLyrics(player.audio.currentTime || 0);
}

function saveLyricsButton(ly) {
  return ly.online ? '<div class="set-buttons center"><button class="pill-btn small" type="button" data-action="save-lyrics">Save these lyrics to my folder</button></div>' : '';
}

async function saveCurrentLyrics(btn) {
  const t = player.current();
  if (!t || !currentLyrics?.online) return;
  btn.disabled = true;
  try {
    const blocked = await allowSaving([t.src]);
    if (blocked.size) throw new Error('Saving was not allowed.');
    await saveToFolder(t.folderId, t.src, t.file.replace(/\.[^.]+$/, '') + '.lrc', new Blob([currentLyrics.rawText], { type: 'text/plain' }));
    toast('Saved as a .lrc file next to the song.');
    refreshLibrary({ quiet: true, only: t.src });
  } catch (e) {
    toast(e.message || "Couldn't save the lyrics.");
    btn.disabled = false;
  }
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
    </div>
    <div class="set-buttons"><button class="pill-btn small light" type="button" data-action="fix-track" data-id="${esc(t.id)}">${ICON.wand}<span>Fix info &amp; cover</span></button><button class="pill-btn small" type="button" data-action="edit-track" data-id="${esc(t.id)}">${ICON.pencil}<span>Edit</span></button>${t.fixed ? '<span class="q lossless">Fixed by you</span>' : ''}</div>`;
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
  html += `<div class="info-group analysis-group"><h4>Audio analysis</h4><div id="analysis" class="analysis">
    <p class="info-note">Spectrogram, lossless check (spots FLACs made from MP3s or fake Hi-Res), peak, loudness and dynamic range. Downloads the whole song once.</p>
    <button class="pill-btn small light" type="button" data-action="analyze" data-id="${esc(t.id)}">Analyze</button></div></div>`;
  html += group('File', [
    kv('Name', t.file), kv('Size', fmtSize(t.size)), kv('Folder', t.path),
    kv('Modified in Drive', t.modified ? new Date(t.modified).toLocaleString() : ''),
  ].join(''));
  openSheet('info', 'Song info', html, push);
  sheetTrackId = id;
  if (analysisCache.has(id)) $('#analysis').innerHTML = analysisHtml(analysisCache.get(id), t);
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
      <span class="row-end"><span class="dur">${t.duration ? fmt(t.duration) : ''}</span>
      <button class="more" type="button" data-action="dequeue" data-pos="${s.pos + 1 + k}" aria-label="Remove from queue">${ICON.close}</button></span>
    </div>`;
  });
  const html = items.length ? `<div class="set-buttons"><button class="pill-btn small" type="button" data-action="clear-queue">Clear up next</button></div><div class="rows">${items.join('')}</div>`
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
        <button class="pill-btn small" type="button" data-set-action="organize">${ICON.wand}<span>Organize library</span></button>
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
      <div class="set-row col">
        <span><b>Crossfade</b><small>Blend the end of each song into the next. Off still starts the next song without a gap. On iPhone, if music stops when the screen locks, set this to Off.</small></span>
        <div class="seg small" role="radiogroup" aria-label="Crossfade">
          ${[0, 3, 6, 9, 12].map((v) => `<button type="button" role="radio" aria-checked="${settings.crossfade === v}" class="${settings.crossfade === v ? 'on' : ''}" data-xf="${v}">${v ? v + ' s' : 'Off'}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="info-group set-group">
      <h4>Display</h4>
      ${toggleRow('dynamicColor', 'Colors from album art', 'Tint screens with each cover’s colors.')}
      ${toggleRow('showTech', 'Technical line', 'Codec, bitrate, sample rate and bit depth on Now Playing.')}
      ${toggleRow('lyricsPreview', 'Lyric preview', 'Current lyric line under the song title.')}
      ${toggleRow('writeTags', 'Save edits into music files', 'When you edit or fix a FLAC or MP3, write the new tags and cover into the file itself.')}
      ${toggleRow('artistInfo', 'Artist photos and bios', 'From Wikipedia. Only artist names are sent.')}
      ${toggleRow('onlineLookup', 'Find missing lyrics and covers', 'From LRCLIB (lyrics) and Apple iTunes (covers). Only song, artist and album names are sent.')}
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
  const xf = e.target.closest('[data-xf]');
  if (xf) {
    setSetting('crossfade', Number(xf.dataset.xf));
    player.setCrossfade(settings.crossfade);
    openSettings(false);
    return;
  }
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
  if (act === 'reset-rules') { resetRules(); toast('All merges undone.'); openSettings(false); }
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
  if (act === 'organize') openOrganize(false);
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

// ================= song menu, likes, playlists =================
function openSongMenu(trackId, { playlistId = '' } = {}) {
  const t = lib?.tracksById[trackId];
  if (!t) return;
  const liked = isLiked(t.key);
  const item = (act, icon, label, extra = '') => `<button class="menu-item" type="button" data-song="${act}" ${extra}>${icon}<span>${label}</span></button>`;
  const html = `
    <div class="info-hero">
      <span class="art" data-cover="${esc(t.cover)}" data-seed="${esc(t.album)}"></span>
      <div><b>${esc(t.title)}</b><small>${esc([t.artist, t.album].filter(Boolean).join(' · '))}</small></div>
    </div>
    <div class="menu-list" data-track="${esc(t.id)}" data-playlist="${esc(playlistId)}">
      ${item('like', liked ? ICON.heartFill : ICON.heart, liked ? 'Remove from Liked songs' : 'Add to Liked songs')}
      ${item('next', ICON.playNext, 'Play next')}
      ${item('queue', ICON.queue, 'Add to queue')}
      ${item('playlist', ICON.plus, 'Add to playlist…')}
      ${playlistId && playlistId !== 'liked' ? item('unlist', ICON.close, 'Remove from this playlist') : ''}
      ${item('album', ICON.album, 'Go to album')}
      ${t.albumArtist || t.artist ? item('artist', ICON.mic, 'Go to artist') : ''}
      ${item('fix', ICON.wand, 'Fix info & cover')}
      ${item('edit', ICON.pencil, 'Edit info')}
      ${item('info', ICON.info, 'Song info & audio analysis')}
    </div>`;
  openSheet('menu', 'Song', html, !sheetKind);
}

function openPlaylistPicker(trackIds) {
  const keys = trackIds.map((id) => lib.tracksById[id]?.key).filter(Boolean);
  const html = `
    <form class="set-inline" data-form="new-playlist">
      <input id="new-playlist" class="set-input" type="text" placeholder="New playlist name" autocomplete="off">
      <button class="pill-btn small light" type="submit">Create</button>
    </form>
    <div class="menu-list" data-keys="${esc(keys.join('\n'))}">
      ${playlists().map((p) => `<button class="menu-item" type="button" data-pick-playlist="${esc(p.id)}">${ICON.queue}<span>${esc(p.name)}</span><small>${plural(p.keys.length, 'song')}</small></button>`).join('')
        || '<p class="info-note">No playlists yet. Create one above.</p>'}
    </div>`;
  openSheet('pick-playlist', 'Add to playlist', html, false);
}

function onMenuEvent(e) {
  if (sheetKind === 'pick-playlist') {
    const keys = ($('#sheet-body .menu-list')?.dataset.keys || '').split('\n').filter(Boolean);
    if (e.type === 'submit' && e.target.closest('[data-form="new-playlist"]')) {
      e.preventDefault();
      const name = $('#new-playlist').value.trim();
      if (!name) return;
      const pl = createPlaylist(name, keys);
      closeSheet();
      toast(`Created "${pl.name}".`);
      return;
    }
    const pick = e.type === 'click' && e.target.closest('[data-pick-playlist]');
    if (pick) {
      const added = addToPlaylist(pick.dataset.pickPlaylist, keys);
      const pl = playlists().find((p) => p.id === pick.dataset.pickPlaylist);
      closeSheet();
      toast(added ? `Added to "${pl?.name}".` : `Already in "${pl?.name}".`);
    }
    return;
  }
  if (sheetKind !== 'menu' || e.type !== 'click') return;
  const btn = e.target.closest('[data-song]');
  if (!btn) return;
  const box = btn.closest('.menu-list');
  const t = lib?.tracksById[box.dataset.track];
  if (!t) return;
  const act = btn.dataset.song;
  if (act === 'like') { const on = toggleLike(t.key); closeSheet(); toast(on ? 'Added to Liked songs.' : 'Removed from Liked songs.'); }
  if (act === 'next') { withAuth(() => player.enqueue([t], { next: true })); closeSheet(); toast('Plays next.'); }
  if (act === 'queue') { withAuth(() => player.enqueue([t])); closeSheet(); toast('Added to the queue.'); }
  if (act === 'playlist') openPlaylistPicker([t.id]);
  if (act === 'unlist') { removeFromPlaylist(box.dataset.playlist, t.key); closeSheet(); toast('Removed from the playlist.'); }
  if (act === 'album') { closeSheet(); setNowOpen(false); setTimeout(() => { location.hash = 'album/' + encodeURIComponent(t.albumKey); }, 60); }
  if (act === 'artist') { closeSheet(); setNowOpen(false); setTimeout(() => { location.hash = 'artist/' + encodeURIComponent(t.albumArtist || t.artist); }, 60); }
  if (act === 'fix') openFix(t.id, false);
  if (act === 'edit') openEdit(t.id, false);
  if (act === 'info') openTrackInfo(t.id, false);
}

function likedTracks() {
  const likes = getRules().likes || {};
  const byKey = new Map(lib.tracks.map((t) => [t.key, t]));
  return Object.entries(likes).sort((a, b) => b[1] - a[1]).map(([k]) => byKey.get(k)).filter(Boolean);
}

function playlistTracks(pl) {
  const byKey = new Map(lib.tracks.map((t) => [t.key, t]));
  return pl.keys.map((k) => byKey.get(k)).filter(Boolean);
}

function renderPlaylists() {
  const liked = likedTracks();
  const card = (href, cover, seed, name, sub, cls = '') => `
    <a class="card ${cls}" href="${href}">
      <div class="art" data-cover="${esc(cover)}" data-seed="${esc(seed)}"></div>
      <b>${esc(name)}</b><small>${esc(sub)}</small>
    </a>`;
  return `<section class="section"><div class="grid">
    <a class="card liked-card" href="#playlist/liked"><div class="art liked-art">${ICON.heartFill}</div><b>Liked songs</b><small>${plural(liked.length, 'song')}</small></a>
    ${playlists().map((p) => { const ts = playlistTracks(p); return card(`#playlist/${encodeURIComponent(p.id)}`, ts[0]?.cover || '', p.name, p.name, plural(ts.length, 'song')); }).join('')}
    <button class="card new-card" type="button" data-action="new-playlist"><div class="art new-art">${ICON.plus}</div><b>New playlist</b><small>Add songs from any song's ··· menu</small></button>
  </div></section>`;
}

function renderPlaylist(id) {
  const isLikedList = id === 'liked';
  const pl = isLikedList ? null : playlists().find((p) => p.id === id);
  if (!isLikedList && !pl) return renderHome('playlists');
  const tracks = isLikedList ? likedTracks() : playlistTracks(pl);
  lists.playlist = tracks;
  const name = isLikedList ? 'Liked songs' : pl.name;
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  return `
    <div class="page" data-tint="${esc(tracks[0]?.cover || '')}" data-seed="${esc(name)}">
      <header class="page-hero">
        <div class="page-top">
          <button class="round-btn" type="button" data-action="back" aria-label="Back">${ICON.back}</button>
          ${isLikedList ? '<span></span>' : `<button class="round-btn" type="button" data-action="playlist-menu" data-id="${esc(id)}" aria-label="Playlist options">${ICON.more}</button>`}
        </div>
        ${isLikedList ? `<div class="art hero-art liked-art">${ICON.heartFill}</div>` : `<div class="art hero-art" data-cover="${esc(tracks[0]?.cover || '')}" data-seed="${esc(name)}"></div>`}
        <h1>${esc(name)}</h1>
        <div class="hero-meta">Playlist · ${plural(tracks.length, 'song')}${total ? ' · ' + fmtTotal(total) : ''}</div>
        <div class="hero-actions">
          <button class="round-btn" type="button" data-action="shuffle-list" data-list="playlist" aria-label="Shuffle" ${tracks.length ? '' : 'disabled'}>${ICON.shuffle}</button>
          <button class="pill-btn" type="button" data-action="play-list" data-list="playlist" ${tracks.length ? '' : 'disabled'}>${ICON.play}<span>Play</span></button>
        </div>
      </header>
      ${tracks.length ? `<section class="section"><div class="rows">${tracks.map((t, i) => songRow(t, 'playlist', i, { showArt: true, playlistId: id })).join('')}</div></section>`
        : `<div class="empty small"><p>${isLikedList ? 'Tap ♥ on any song to add it here.' : "Add songs from any song's ··· menu."}</p></div>`}
    </div>`;
}

function openPlaylistMenu(id) {
  const pl = playlists().find((p) => p.id === id);
  if (!pl) return;
  const html = `
    <form class="set-inline" data-form="rename-playlist" data-id="${esc(id)}">
      <input id="rename-playlist" class="set-input" type="text" value="${esc(pl.name)}" autocomplete="off" aria-label="Playlist name">
      <button class="pill-btn small" type="submit">Rename</button>
    </form>
    <div class="menu-list">
      <button class="menu-item" type="button" data-pl="queue" data-id="${esc(id)}">${ICON.queue}<span>Add all to queue</span></button>
      <button class="menu-item danger" type="button" data-pl="delete" data-id="${esc(id)}">${ICON.close}<span>Delete playlist</span></button>
    </div>
    <p class="info-note">Deleting a playlist doesn't delete any songs.</p>`;
  openSheet('playlist-menu', pl.name, html);
}

function onPlaylistMenuEvent(e) {
  if (sheetKind !== 'playlist-menu') return;
  if (e.type === 'submit' && e.target.closest('[data-form="rename-playlist"]')) {
    e.preventDefault();
    renamePlaylist(e.target.closest('form').dataset.id, $('#rename-playlist').value);
    closeSheet();
    toast('Renamed.');
    return;
  }
  const btn = e.type === 'click' && e.target.closest('[data-pl]');
  if (!btn) return;
  const pl = playlists().find((p) => p.id === btn.dataset.id);
  if (btn.dataset.pl === 'queue' && pl) { withAuth(() => player.enqueue(playlistTracks(pl))); closeSheet(); toast('Added to the queue.'); }
  if (btn.dataset.pl === 'delete' && pl) {
    if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.querySelector('span').textContent = 'Tap again to delete'; return; }
    deletePlaylist(pl.id);
    closeSheet();
    location.hash = 'playlists';
    toast(`Deleted "${pl.name}".`);
  }
}

// ================= history & shelves =================
const HISTORY_KEY = 'mp.history.v1';
let recent = []; // song keys, most recently played first
try { recent = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { recent = []; }

function remember(t) {
  recent = [t.key, ...recent.filter((k) => k !== t.key)].slice(0, 150);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(recent)); } catch (e) { /* ignore */ }
}

function shelvesHtml() {
  const byKey = new Map(lib.tracks.map((t) => [t.key, t]));
  const seen = new Set();
  const recentAlbums = recent.map((k) => byKey.get(k)).filter(Boolean)
    .map((t) => lib.albumsById[t.albumKey]).filter((a) => a && !seen.has(a.key) && seen.add(a.key)).slice(0, 12);
  const added = lib.albums.slice().sort((a, b) => {
    const at = (x) => Math.max(...x.tracks.map((t) => Date.parse(t.modified) || 0));
    return at(b) - at(a);
  }).slice(0, 12);
  const most = lib.tracks.filter((t) => plays[t.key]).sort((a, b) => plays[b.key] - plays[a.key]).slice(0, 12);
  lists.most = most;
  const shelf = (title, items) => (items ? `<section class="section shelf-section"><h2 class="section-title">${title}</h2><div class="shelf">${items}</div></section>` : '');
  return [
    recentAlbums.length ? shelf('Recently played', recentAlbums.map(albumCard).join('')) : '',
    most.length >= 3 ? shelf('Most played', most.map((t, i) => `
      <button class="card" type="button" data-action="play-track" data-list="most" data-i="${i}">
        <div class="art" data-cover="${esc(t.cover)}" data-seed="${esc(t.album)}"></div>
        <b>${esc(t.title)}</b><small>${esc(t.artist || t.album)} · ${plural(plays[t.key], 'play')}</small>
      </button>`).join('')) : '',
    lib.albums.length > 4 ? shelf('Recently added', added.map(albumCard).join('')) : '',
  ].join('');
}

// ================= sleep timer =================
function openSleep() {
  const s = player.state;
  const on = s.sleepAt !== 0;
  const left = s.sleepAt > 0 ? Math.max(0, Math.ceil((s.sleepAt - Date.now()) / 60e3)) : 0;
  const opt = (v, label) => `<button class="menu-item" type="button" data-sleep="${v}">${ICON.moon}<span>${label}</span></button>`;
  const html = `
    ${on ? `<p class="info-note first">${s.sleepAt === -1 ? 'Stops after this song.' : `Stops in ${plural(left, 'minute')}.`}</p>` : '<p class="info-note first">Music fades out and stops.</p>'}
    <div class="menu-list">
      ${[15, 30, 45, 60, 90].map((m) => opt(m, `${m} minutes`)).join('')}
      ${opt('end', 'End of this song')}
      ${on ? `<button class="menu-item danger" type="button" data-sleep="0">${ICON.close}<span>Turn off timer</span></button>` : ''}
    </div>`;
  openSheet('sleep', 'Sleep timer', html);
}

function onSleepEvent(e) {
  if (sheetKind !== 'sleep' || e.type !== 'click') return;
  const v = e.target.closest('[data-sleep]')?.dataset.sleep;
  if (v === undefined) return;
  player.setSleep(v === 'end' ? 'end' : Number(v));
  closeSheet();
  toast(v === '0' ? 'Sleep timer off.' : v === 'end' ? 'Stops after this song.' : `Stops in ${v} minutes.`);
}

function updateSleepButton() {
  const s = player.state;
  const btn = $('#c-sleep');
  btn.classList.toggle('on', s.sleepAt !== 0);
  const left = s.sleepAt > 0 ? Math.max(0, Math.ceil((s.sleepAt - Date.now()) / 60e3)) : 0;
  btn.setAttribute('aria-label', s.sleepAt === -1 ? 'Sleep timer: end of song' : s.sleepAt > 0 ? `Sleep timer: ${left} min left` : 'Sleep timer');
  btn.dataset.left = s.sleepAt > 0 ? String(left) : s.sleepAt === -1 ? '♪' : '';
}

// ================= audio analysis =================
const analysisCache = new Map();

async function runAnalysis(t, btn) {
  const box = $('#analysis');
  if (!box) return;
  if (analysisCache.has(t.id)) { box.innerHTML = analysisHtml(analysisCache.get(t.id), t); return; }
  btn.disabled = true;
  box.innerHTML = `<div class="analysis-wait">${ICON.spinner}<span>Downloading and decoding the whole song… (${fmtSize(t.size)})</span></div>`;
  try {
    const blob = await readBlob({ id: t.id, src: t.src });
    const res = await analyzeAudio(blob, { sampleRate: t.meta?.sampleRate, lossless: !!t.meta?.lossless });
    analysisCache.set(t.id, res);
    if ($('#analysis')) $('#analysis').innerHTML = analysisHtml(res, t);
  } catch (e) {
    if ($('#analysis')) $('#analysis').innerHTML = `<p class="info-note">Couldn't analyze this file in this browser: ${esc(e.message || e)}</p>`;
    btn.disabled = false;
  }
}

function analysisHtml(r, t) {
  const ticks = [];
  const topK = r.nyquist / 1000;
  const stepK = topK > 40 ? 20 : topK > 24 ? 10 : 5;
  for (let k = 0; k <= topK; k += stepK) ticks.push(k);
  const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '−∞');
  return `
    <div class="verdict ${r.level}">${esc(r.verdict)}</div>
    <div class="spectro">
      <img src="${r.image}" alt="Spectrogram of ${esc(t.title)}">
      <div class="spectro-axis">${ticks.reverse().map((k) => `<span style="top:${(1 - (k * 1000) / r.nyquist) * 100}%">${k} kHz</span>`).join('')}</div>
    </div>
    <p class="spectro-cap">Time → · brightness = loudness · dashed line = detected cutoff (${(r.cutoffHz / 1000).toFixed(1)} kHz)</p>
    <dl>
      ${kv('Frequency cutoff', `${(r.cutoffHz / 1000).toFixed(1)} kHz of ${(r.nyquist / 1000).toFixed(1)} kHz`)}
      ${kv('Peak', `${f1(r.peakDb)} dBFS`)}
      ${kv('Average level (RMS)', `${f1(r.rmsDb)} dBFS`)}
      ${kv('Dynamic range (approx.)', `${f1(r.drDb)} dB${r.drDb < 7 ? ' · heavily compressed' : r.drDb > 12 ? ' · very dynamic' : ''}`)}
      ${kv('Clipped samples', r.clipped.toLocaleString('en-US'))}
    </dl>`;
}

// ================= edit song info (and write it into the file) =================
const EDIT_FIELDS = [
  ['TITLE', 'Title', 'title'], ['ARTIST', 'Artist', 'artist'], ['ALBUM', 'Album', 'album'],
  ['ALBUMARTIST', 'Album artist', 'albumArtist'], ['DATE', 'Year', 'year'], ['GENRE', 'Genre', 'genre'],
  ['TRACKNUMBER', 'Track no.', 'trackNo'], ['DISCNUMBER', 'Disc no.', 'discNo'],
];
const editState = { trackId: '', coverBlob: null, coverUrl: '' };

function openEdit(trackId, push = true) {
  const t = lib?.tracksById[trackId];
  if (!t) return;
  if (editState.trackId !== trackId) Object.assign(editState, { trackId, coverBlob: null, coverUrl: '' });
  const writable = canWriteTags(t.meta);
  const val = (k) => {
    if (k === 'trackNo') return t.trackNo ? String(t.trackNo) + (first(t.meta, 'TRACKTOTAL') ? '/' + first(t.meta, 'TRACKTOTAL') : '') : '';
    if (k === 'discNo') return t.discNo > 1 || first(t.meta, 'DISCNUMBER') ? String(t.discNo) : '';
    return t[k] || '';
  };
  const coverPreview = editState.coverBlob ? URL.createObjectURL(editState.coverBlob) : '';
  const html = `
    <form class="edit-form" data-form="edit">
      <div class="edit-cover">
        <span class="art" id="edit-art" data-cover="${esc(t.cover)}" data-seed="${esc(t.album)}" ${coverPreview ? `style="background-image:url('${coverPreview}')"` : ''}></span>
        <div class="edit-cover-actions">
          <button class="pill-btn small" type="button" data-edit="pick-cover">Choose image</button>
          <button class="pill-btn small" type="button" data-edit="find">${ICON.wand}<span>Find online</span></button>
          <small>${editState.coverBlob ? 'New cover selected' : 'Cover'}</small>
        </div>
      </div>
      ${EDIT_FIELDS.map(([key, label, prop]) => `
        <label class="edit-field"><span>${label}</span>
          <input class="set-input" name="${key}" value="${esc(val(prop))}" autocomplete="off" ${key === 'DATE' ? 'inputmode="numeric"' : ''}></label>`).join('')}
      <label class="set-row edit-write">
        <span><b>Save into the music file</b><small>${writable ? `Writes the tags into this ${t.ext} so every player sees them. The audio isn't touched${sourceById(t.src)?.kind === 'drive' ? ' and Drive keeps the old version for 30 days' : ''}.` : `${t.ext} files can't be edited yet. This change is saved in N4cuply only.`}</small></span>
        <input type="checkbox" class="switch" name="write" ${writable && settings.writeTags ? 'checked' : ''} ${writable ? '' : 'disabled'}>
      </label>
      <div class="set-buttons">
        <button class="pill-btn light" type="submit">Save</button>
        ${t.fixed ? '<button class="pill-btn" type="button" data-edit="undo">Undo app-only changes</button>' : ''}
      </div>
    </form>`;
  openSheet('edit', 'Edit info', html, push);
  if (coverPreview) $('#edit-art').classList.add('has-img');
}

function readEditForm() {
  const form = $('.edit-form');
  const out = {};
  for (const [key] of EDIT_FIELDS) out[key] = form.elements[key].value.trim();
  return { fields: out, write: !!form.elements.write?.checked };
}

/** Rule values (app-only) from edited tag fields. */
function ruleFromFields(f, cover) {
  const [n] = f.TRACKNUMBER.split('/');
  return {
    title: f.TITLE, artist: f.ARTIST, album: f.ALBUM, albumArtist: f.ALBUMARTIST, year: f.DATE, genre: f.GENRE,
    trackNo: parseInt(n, 10) || 0, discNo: parseInt(f.DISCNUMBER, 10) || 0, ...(cover ? { cover } : {}),
  };
}

async function coverBytes(source) {
  if (!source) return null;
  const blob = source instanceof Blob ? source : await (await fetch(source.replace(/^url:/, ''))).blob();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/jpeg' };
}

async function sha(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Writes tags (and optionally a cover) into the song's file, after checking
 * the new file reads back correctly and its audio is byte-for-byte the same.
 * Permissions must already be granted (allowSaving) from the click.
 */
async function saveTagsToFile(t, fields, coverSource, progress = (msg) => toast(msg)) {
  progress(`Reading "${t.title}"…`);
  const original = new Uint8Array(await (await readBlob({ id: t.id, src: t.src })).arrayBuffer());
  const readBack = (buf) => readMeta(new RangeReader(async (s, e) => buf.buffer.slice(buf.byteOffset + s, buf.byteOffset + e + 1), buf.length), t.file);
  const before = await readBack(original);
  const out = writeTags(original, before, fields, await coverBytes(coverSource));
  const after = await readBack(out);
  const sameAudio = (await sha(original.subarray(before.audioOffset))) === (await sha(out.subarray(after.audioOffset)));
  const titleOk = !fields.TITLE || first(after, 'TITLE') === fields.TITLE;
  if (!sameAudio || !titleOk || Math.abs((after.duration || 0) - (before.duration || 0)) > 0.05) {
    throw new Error('Safety check failed, so the file was not changed.');
  }
  await overwriteFile(t, out, (p) => progress(`Saving "${t.title}"… ${Math.round(p * 100)}%`));
  // The file's size changed, so its key did too: keep likes, playlists and plays.
  const newKey = trackKeyOf(t.file, out.length);
  if (newKey !== t.key) {
    if (plays[t.key]) { plays[newKey] = plays[t.key]; delete plays[t.key]; try { localStorage.setItem(PLAYS_KEY, JSON.stringify(plays)); } catch (e) { /* ignore */ } }
    recent = recent.map((k) => (k === t.key ? newKey : k));
    rekeyTrack(t.key, newKey);
  }
  return out.length;
}

async function saveEdit(e) {
  e.preventDefault();
  const t = lib?.tracksById[editState.trackId];
  if (!t) return;
  const { fields, write } = readEditForm();
  const cover = editState.coverBlob || editState.coverUrl || null;
  const btn = $('.edit-form [type=submit]');
  btn.disabled = true;
  if (!write) {
    if (cover instanceof Blob) toast('A chosen image can only be saved into the file. Other changes were saved.');
    setTrackFix(t.key, ruleFromFields(fields, typeof cover === 'string' ? cover : ''));
    closeSheet();
    toast('Saved in N4cuply.');
    return;
  }
  try {
    const blocked = await allowSaving([t.src]);
    if (blocked.size) throw new Error('Saving into the file was not allowed.');
    await saveTagsToFile(t, fields, cover);
    clearTrackFix(t.key);
    closeSheet();
    toast('Saved into the file.');
    refreshLibrary({ quiet: true, only: t.src });
  } catch (err) {
    toast(err.message || "Couldn't save into the file.");
    btn.disabled = false;
  }
}

function onEditEvent(e) {
  if (sheetKind !== 'edit') return;
  if (e.type === 'submit' && e.target.closest('[data-form="edit"]')) { saveEdit(e); return; }
  if (e.type !== 'click') return;
  const act = e.target.closest('[data-edit]')?.dataset.edit;
  if (act === 'pick-cover') $('#cover-input').click();
  if (act === 'find') openFix(editState.trackId, false);
  if (act === 'undo') {
    const t = lib?.tracksById[editState.trackId];
    if (t) clearTrackFix(t.key);
    closeSheet();
    toast('App-only changes undone.');
  }
}

/** ✨ match picked: show it now (rule) and write it into the file if allowed. */
async function applyMatch(t, c) {
  const fix = fixFrom(c);
  setTrackFix(t.key, fix);
  closeSheet();
  if (!settings.writeTags || !canWriteTags(t.meta)) {
    toast(`Updated "${c.title}".`);
    return;
  }
  const fields = {
    TITLE: c.title, ARTIST: c.artist, ALBUM: c.album, ALBUMARTIST: c.albumArtist, DATE: c.year, GENRE: c.genre,
    TRACKNUMBER: c.trackNo ? (c.trackTotal ? `${c.trackNo}/${c.trackTotal}` : String(c.trackNo)) : '',
    DISCNUMBER: c.discNo > 1 ? String(c.discNo) : '',
  };
  try {
    const blocked = await allowSaving([t.src]);
    if (blocked.size) throw new Error('Shown in N4cuply; saving into the file was not allowed.');
    await saveTagsToFile(t, fields, fix.cover || null);
    clearTrackFix(t.key);
    toast(`Updated "${c.title}" and saved it into the file.`);
    refreshLibrary({ quiet: true, only: t.src });
  } catch (err) {
    toast(err.message || 'Shown in N4cuply; saving into the file failed.');
  }
}

/** Writes all app-only fixes into their files (Organize). */
async function writeFixesToFiles(tracks) {
  const blocked = await allowSaving(tracks.map((t) => t.src));
  const touched = new Set();
  let ok = 0;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (blocked.has(t.src)) continue;
    const fix = getRules().tracks?.[t.key];
    if (!fix) continue;
    const fields = {
      TITLE: t.title, ARTIST: t.artist, ALBUM: t.album, ALBUMARTIST: t.albumArtist, DATE: t.year, GENRE: t.genre,
      TRACKNUMBER: t.trackNo ? String(t.trackNo) : '', DISCNUMBER: t.discNo > 1 ? String(t.discNo) : '',
    };
    try {
      await saveTagsToFile(t, fields, fix.cover || null, (msg) => orgProgress(msg, i, tracks.length));
      clearTrackFix(t.key);
      touched.add(t.src);
      ok++;
    } catch (e) { /* leave this one app-only */ }
  }
  orgProgress(`Saved ${ok} of ${tracks.length} songs into their files.`, tracks.length, tracks.length);
  return touched;
}

// ================= play counts (for "Popular") =================
const PLAYS_KEY = 'mp.plays.v1';
let plays = {};
try { plays = JSON.parse(localStorage.getItem(PLAYS_KEY) || '{}'); } catch (e) { plays = {}; }
let countedId = '';

function countPlay(t, time) {
  if (!t || countedId === t.id || time < 30) return;
  countedId = t.id;
  plays[t.key] = (plays[t.key] || 0) + 1;
  remember(t);
  try { localStorage.setItem(PLAYS_KEY, JSON.stringify(plays)); } catch (e) { /* ignore */ }
}

// ================= artist profiles =================
const artistFetching = new Set();
const artistsTried = new Set();

function loadArtistInfo(name, online) {
  if (artistFetching.has(name)) return;
  artistFetching.add(name);
  artistInfo(name, { online }).then((info) => {
    artistFetching.delete(name);
    if (info) render();
  });
}

function artistPhoto(name) {
  const info = peekArtist(name);
  return info?.image ? 'url:' + info.image : '';
}

// ================= fix song info =================
const fixState = { trackId: '', term: '', results: null, error: '', loading: false };

/** Songs worth fixing: missing core tags or cover, and not fixed by the user yet. */
const needsFix = (t) => !t.fixed && (!t.meta?.tags?.TITLE || !t.meta?.tags?.ARTIST || !t.meta?.tags?.ALBUM || !t.cover);

function fixFrom(c) {
  return {
    title: c.title, artist: c.artist, albumArtist: c.albumArtist, album: c.album, year: c.year,
    genre: c.genre, trackNo: c.trackNo, discNo: c.discNo, cover: c.cover ? 'url:' + c.cover : '', source: 'itunes:' + c.id,
  };
}

async function openFix(trackId, push = true, term) {
  const t = lib?.tracksById[trackId];
  if (!t) return;
  if (fixState.trackId !== trackId || term !== undefined) {
    Object.assign(fixState, { trackId, term: term ?? searchTermFor(t), results: null, error: '', loading: true });
    renderFix(push);
    try {
      fixState.results = await findSongMatches(t, fixState.term);
    } catch (e) {
      fixState.error = e.message || 'Search failed.';
    }
    fixState.loading = false;
    if (fixState.trackId === trackId && sheetKind === 'fix') renderFix(false);
    return;
  }
  renderFix(push);
}

function renderFix(push) {
  const t = lib?.tracksById[fixState.trackId];
  if (!t) return;
  const r = fixState.results;
  const label = (c) => (c.score >= 80 ? 'Best match' : c.score >= 50 ? 'Possible' : 'Weak match');
  const list = fixState.loading ? `<div class="empty small"><div class="loader">${ICON.spinner}</div></div>`
    : fixState.error ? `<p class="info-note">${esc(fixState.error)}</p>`
      : !r?.length ? '<p class="info-note">No matches. Try different words above, like the artist and song name.</p>'
        : `<div class="fix-list">${r.slice(0, 8).map((c, i) => `
          <button class="fix-cand" type="button" data-fix="apply" data-i="${i}">
            <img src="${esc(c.thumb)}" alt="" width="56" height="56" loading="lazy">
            <span class="fix-text"><b>${esc(c.title)}</b><small>${esc(c.artist)}</small><small>${esc([c.album, c.year, c.genre].filter(Boolean).join(' · '))}</small></span>
            <span class="fix-meta"><span class="q ${c.score >= 80 ? 'lossless' : ''}">${label(c)}</span><small>${c.duration ? fmt(c.duration) : ''}</small></span>
          </button>`).join('')}</div>`;
  const html = `
    <div class="info-hero">
      <span class="art" data-cover="${esc(t.cover)}" data-seed="${esc(t.album)}"></span>
      <div><b>${esc(t.title)}</b><small>${esc([t.artist, t.album, t.year].filter(Boolean).join(' · '))}</small>
      <small>${esc(t.file)}${t.duration ? ' · ' + fmt(t.duration) : ''}</small></div>
    </div>
    ${t.fixed ? '<div class="set-row fixed-row"><span><b>You fixed this song</b><small>The original file is unchanged.</small></span><button class="pill-btn small" type="button" data-fix="undo">Undo</button></div>' : ''}
    <div class="set-buttons"><button class="pill-btn small" type="button" data-action="edit-track" data-id="${esc(t.id)}">${ICON.pencil}<span>Edit manually</span></button></div>
    <form class="set-inline fix-search" data-form="fix-search">
      <input id="fix-term" class="set-input" type="search" value="${esc(fixState.term)}" aria-label="Search for this song" autocomplete="off">
      <button class="pill-btn small" type="submit">Search</button>
    </form>
    <p class="info-note">Tap the right match to update title, artist, album, year, genre, track number and cover.${settings.writeTags && canWriteTags(t.meta) ? ' It is also saved into the music file (the audio is not changed).' : ' Saved in N4cuply (synced through your Drive).'}</p>
    ${list}`;
  openSheet('fix', 'Fix info & cover', html, push);
}

function onFixEvent(e) {
  if (sheetKind !== 'fix') return;
  if (e.type === 'submit' && e.target.closest('[data-form="fix-search"]')) {
    e.preventDefault();
    openFix(fixState.trackId, false, $('#fix-term').value.trim());
    return;
  }
  if (e.type !== 'click') return;
  const btn = e.target.closest('[data-fix]');
  if (!btn) return;
  const t = lib?.tracksById[fixState.trackId];
  if (!t) return;
  if (btn.dataset.fix === 'apply') {
    const c = fixState.results?.[Number(btn.dataset.i)];
    if (!c) return;
    applyMatch(t, c);
  } else if (btn.dataset.fix === 'undo') {
    clearTrackFix(t.key);
    toast('Back to the file’s own info.');
    closeSheet();
  }
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fixes songs whose best match is confident. Returns the ones that need a manual pick. */
async function autoFixSongs(tracks) {
  const fixes = {};
  const unsure = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    orgProgress(`Song info: ${t.title}`, i, tracks.length);
    try {
      const matches = await findSongMatches(t);
      const best = matches[0];
      if (best && isConfident(t, best)) fixes[t.key] = fixFrom(best);
      else unsure.push(t.id);
    } catch (e) {
      unsure.push(t.id);
    }
    if (i < tracks.length - 1) await sleepMs(3200); // iTunes allows ~20 searches a minute
  }
  setTrackFixes(fixes);
  org.unsure = unsure;
  orgProgress(`Song info: fixed ${Object.keys(fixes).length} of ${tracks.length}.${unsure.length ? ` ${unsure.length} need your pick below.` : ''}`, tracks.length, tracks.length);
}

// ================= organize =================
const hasLyrics = (t) => !!(t.lrcId || first(t.meta, 'LYRICS') || t.meta?.syncedLyrics?.length);
const org = { busy: false, log: '', done: 0, total: 0 };

function openOrganize(push = true) {
  if (!lib) return;
  const res = analyze(lib, hasLyrics);
  res.needFix = lib.tracks.filter(needsFix);
  const issues = res.artists.length + res.albums.length;
  const online = settings.onlineLookup;
  const busy = org.busy;
  const synced = scans.default?.rulesFileId ? 'Fixes are saved to your Drive and sync to your other devices.' : 'Fixes are saved on this device, and to your Drive once upload permission is allowed.';
  const html = `
    <p class="info-note first">${issues ? `${plural(issues, 'thing')} to tidy up` : 'Artists and albums look tidy.'} · ${plural(res.needFix.length, 'song')} missing info · ${plural(res.noCover.length, 'album')} without a cover · ${plural(res.noLyrics.length, 'song')} without lyrics</p>
    <div class="set-buttons">
      <button class="pill-btn light" type="button" data-org="fix-all" ${busy ? 'disabled' : ''}>${ICON.wand}<span>Fix everything</span></button>
    </div>
    ${org.log || busy ? `<div class="org-progress"><span id="org-log">${esc(org.log)}</span><div class="scan-bar"><i id="org-bar" style="width:${org.total ? (org.done / org.total) * 100 : 0}%"></i></div></div>` : ''}

    <div class="info-group set-group">
      ${toggleRow('onlineLookup', 'Find missing lyrics and covers online', 'Uses LRCLIB for lyrics and Apple iTunes for covers. Only artist, song and album names are sent. Results are saved into your folders.')}
    </div>

    ${res.artists.length ? `<div class="info-group set-group"><h4>Same artist?</h4>
      ${res.artists.map((g) => `<div class="org-item" data-group="${esc(g.id)}">
        <div class="org-choices">${g.names.map((n) => `<label class="org-choice"><input type="radio" name="${esc(g.id)}" value="${esc(n.name)}" ${n.name === g.canonical ? 'checked' : ''}><span>${esc(n.name)}</span><small>${plural(n.count, 'song')}</small></label>`).join('')}</div>
        <div class="org-actions"><button class="pill-btn small light" type="button" data-org="merge-artist">Merge into selected</button><button class="pill-btn small" type="button" data-org="ignore">Not the same</button></div>
      </div>`).join('')}</div>` : ''}

    ${res.albums.length ? `<div class="info-group set-group"><h4>Split albums</h4>
      ${res.albums.map((g) => `<div class="org-item" data-group="${esc(g.id)}" data-keys="${esc(g.albums.map((a) => a.key).join('\n'))}" data-target="${esc(g.target)}">
        <div class="org-choices">${g.albums.map((a) => `<div class="org-choice static"><span>${esc(a.name)}</span><small>${esc(a.artist || '')} · ${plural(a.tracks.length, 'song')} · ${esc(a.tracks[0].path)}</small></div>`).join('')}</div>
        <div class="org-actions"><button class="pill-btn small light" type="button" data-org="merge-album">Merge</button><button class="pill-btn small" type="button" data-org="ignore">Keep separate</button></div>
      </div>`).join('')}</div>` : ''}

    <div class="info-group set-group"><h4>Song info</h4>
      <div class="set-row"><span><b>${plural(res.needFix.length, 'song')} with missing info or cover</b><small>Matches each song on Apple iTunes by its name. Only sure matches are applied automatically.</small></span>
      <button class="pill-btn small" type="button" data-org="info" ${!res.needFix.length || busy ? 'disabled' : ''}>Fix</button></div>
      ${(org.unsure || []).map((id) => lib.tracksById[id]).filter((t) => t && !t.fixed).slice(0, 30).map((t) => `
        <div class="set-row"><span><b>${esc(t.title)}</b><small>${esc(t.file)}</small></span>
        <button class="pill-btn small" type="button" data-action="fix-track" data-id="${esc(t.id)}">Choose</button></div>`).join('')}
    </div>

    ${(() => {
      const appOnly = lib.tracks.filter((t) => t.fixed && canWriteTags(t.meta));
      return appOnly.length ? `<div class="info-group set-group"><h4>Save into files</h4>
        <div class="set-row"><span><b>${plural(appOnly.length, 'song')} fixed in N4cuply only</b><small>Write their new info and covers into the FLAC / MP3 files so every player sees them. Each file is downloaded and uploaded once.</small></span>
        <button class="pill-btn small" type="button" data-org="write" ${busy ? 'disabled' : ''}>Save</button></div></div>` : '';
    })()}

    <div class="info-group set-group"><h4>Covers</h4>
      <div class="set-row"><span><b>${plural(res.noCover.length, 'album')} without a cover</b><small>${res.noCover.slice(0, 4).map((a) => esc(a.name)).join(', ')}${res.noCover.length > 4 ? '…' : ''}${res.noCover.length ? '' : 'All albums have covers.'}</small></span>
      <button class="pill-btn small" type="button" data-org="covers" ${!res.noCover.length || !online || busy ? 'disabled' : ''}>Find</button></div>
    </div>
    <div class="info-group set-group"><h4>Lyrics</h4>
      <div class="set-row"><span><b>${plural(res.noLyrics.length, 'song')} without lyrics</b><small>Found lyrics are saved as a .lrc file next to each song (synced when available).</small></span>
      <button class="pill-btn small" type="button" data-org="lyrics" ${!res.noLyrics.length || !online || busy ? 'disabled' : ''}>Find</button></div>
    </div>
    ${online ? '' : '<p class="info-note">Turn on "Find missing lyrics and covers online" to fill in covers and lyrics.</p>'}
    <p class="info-note">${esc(synced)}</p>
    <button class="text-btn pad" type="button" data-org="undo">Undo all merges</button>`;
  openSheet('organize', 'Organize library', html, push);
}

function orgProgress(text, done, total) {
  org.log = text;
  org.done = done;
  org.total = total;
  const log = $('#org-log');
  const bar = $('#org-bar');
  if (log) log.textContent = text;
  if (bar) bar.style.width = `${total ? (done / total) * 100 : 0}%`;
  if (!log && sheetKind === 'organize') openOrganize(false);
}

/** Gets every permission needed to save into these sources. Call from a click. */
async function allowSaving(srcIds) {
  const blocked = new Set();
  for (const id of new Set(srcIds)) {
    const src = sourceById(id);
    if (!src) continue;
    try {
      if (src.kind === 'local') {
        if (!(await requestLocalWrite(id))) blocked.add(id);
      } else {
        const account = accountOf(src);
        if (!canWrite(account) || expiresSoon(account)) await signIn({ write: true, account });
      }
    } catch (e) {
      blocked.add(id);
    }
  }
  return blocked;
}

async function findCovers(albums) {
  const blocked = await allowSaving(albums.map((a) => a.src));
  const touched = new Set();
  let found = 0;
  for (let i = 0; i < albums.length; i++) {
    const a = albums[i];
    orgProgress(`Covers: ${a.name}`, i, albums.length);
    if (blocked.has(a.src)) continue;
    try {
      const blob = await findCover(a);
      if (!blob) continue;
      await saveToFolder(a.folderId, a.src, 'cover.jpg', blob);
      touched.add(a.src);
      found++;
    } catch (e) { /* skip this album */ }
  }
  orgProgress(`Covers: found ${found} of ${albums.length}.${blocked.size ? ' Some folders were not allowed.' : ''}`, albums.length, albums.length);
  return touched;
}

async function findAllLyrics(tracks) {
  const blocked = await allowSaving(tracks.map((t) => t.src));
  const touched = new Set();
  let found = 0;
  let i = 0;
  const worker = async () => {
    while (i < tracks.length) {
      const t = tracks[i++];
      orgProgress(`Lyrics: ${t.title}`, i, tracks.length);
      if (blocked.has(t.src)) continue;
      try {
        const ly = await findLyrics(t);
        if (!ly) continue;
        const name = t.file.replace(/\.[^.]+$/, '') + '.lrc';
        await saveToFolder(t.folderId, t.src, name, new Blob([ly.text], { type: 'text/plain' }));
        touched.add(t.src);
        found++;
      } catch (e) { /* skip this song */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  orgProgress(`Lyrics: found ${found} of ${tracks.length}.${blocked.size ? ' Some folders were not allowed.' : ''}`, tracks.length, tracks.length);
  return touched;
}

async function runOrganize(kind) {
  if (org.busy || !lib) return;
  org.busy = true;
  openOrganize(false);
  const touched = new Set();
  try {
    const res = analyze(lib, hasLyrics);
    if (kind === 'all') {
      for (const g of res.artists) mergeArtists(g.names.map((n) => n.name), g.canonical);
      for (const g of res.albums) mergeAlbums(g.albums.map((a) => a.key), g.target);
      orgProgress(`Merged ${plural(res.artists.length, 'artist group')} and ${plural(res.albums.length, 'album')}.`, 1, 1);
    }
    if (kind === 'write') {
      for (const id of await writeFixesToFiles(lib.tracks.filter((t) => t.fixed && canWriteTags(t.meta)))) touched.add(id);
    }
    if (kind === 'info' || (kind === 'all' && settings.onlineLookup)) {
      const todo = lib.tracks.filter(needsFix);
      if (todo.length) await autoFixSongs(todo);
    }
    if (settings.onlineLookup && (kind === 'all' || kind === 'covers')) {
      const fresh = analyze(lib, hasLyrics).noCover;
      if (fresh.length) for (const id of await findCovers(fresh)) touched.add(id);
    }
    if (settings.onlineLookup && (kind === 'all' || kind === 'lyrics')) {
      const fresh = analyze(lib, hasLyrics).noLyrics;
      if (fresh.length) for (const id of await findAllLyrics(fresh)) touched.add(id);
    }
  } finally {
    org.busy = false;
  }
  for (const id of touched) await refreshLibrary({ quiet: true, only: id });
  if (sheetKind === 'organize') openOrganize(false);
}

function onOrganizeEvent(e) {
  if (sheetKind !== 'organize') return;
  const sw = e.target.closest('[data-set]');
  if (sw && e.type === 'change') {
    setSetting(sw.dataset.set, sw.checked);
    openOrganize(false);
    return;
  }
  if (e.type !== 'click') return;
  const btn = e.target.closest('[data-org]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.org;
  const item = btn.closest('.org-item');
  if (act === 'merge-artist') {
    const names = [...item.querySelectorAll('input[type=radio]')].map((r) => r.value);
    const canonical = item.querySelector('input[type=radio]:checked')?.value || names[0];
    mergeArtists(names, canonical);
    toast(`Merged into "${canonical}".`);
  } else if (act === 'merge-album') {
    mergeAlbums(item.dataset.keys.split('\n'), item.dataset.target);
    toast('Albums merged.');
  } else if (act === 'ignore') {
    ignore(item.dataset.group);
  } else if (act === 'undo') {
    resetRules();
    toast('All merges undone.');
  } else if (act === 'fix-all') {
    runOrganize('all');
    return;
  } else if (act === 'covers' || act === 'lyrics' || act === 'info' || act === 'write') {
    runOrganize(act);
    return;
  }
  openOrganize(false);
}

// Rules changed: rebuild now, save to Drive shortly after.
let rulesTimer = 0;
onRulesChange(() => {
  rebuild();
  render();
  updateLikeButton();
  clearTimeout(rulesTimer);
  rulesTimer = setTimeout(pushRules, 1500);
});

async function pushRules() {
  const scan = scans.default;
  const account = primaryAccount();
  if (!scan || !canWrite(account)) return;
  const blob = new Blob([JSON.stringify(getRules(), null, 1)], { type: 'application/json' });
  try {
    if (scan.rulesFileId) await updateFileContent(scan.rulesFileId, blob, account);
    else scan.rulesFileId = (await uploadFile(new File([blob], RULES_FILE, { type: 'application/json' }), scan.rootId, account)).id || '';
  } catch (e) { /* stays saved on this device; next change retries */ }
}

async function pullRules() {
  const scan = scans.default;
  if (!scan?.rulesFileId) return;
  try {
    const remote = JSON.parse(await (await readBlob({ id: scan.rulesFileId, src: 'default' })).text());
    if (adoptRules(remote)) { rebuild(); render(); }
    else if (getRules().updatedAt > (remote.updatedAt || 0)) pushRules();
  } catch (e) { /* ignore a broken or missing file */ }
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
    if (action === 'dequeue') { e.stopPropagation(); player.removeAt(Number(el.dataset.pos)); return; }
    if (action === 'song-menu') { e.stopPropagation(); openSongMenu(el.dataset.id, { playlistId: el.dataset.playlist || '' }); return; }
    if (action === 'fix-track') { e.stopPropagation(); openFix(el.dataset.id, !sheetKind); return; }
    if (action === 'edit-track') { e.stopPropagation(); openEdit(el.dataset.id, !sheetKind); return; }
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
    else if (action === 'new-playlist') { openPlaylistPicker([]); $('#sheet-title').textContent = 'New playlist'; }
    else if (action === 'playlist-menu') openPlaylistMenu(el.dataset.id);
    else if (action === 'analyze') { const t = lib.tracksById[el.dataset.id]; if (t) runAnalysis(t, el); }
    else if (action === 'artist-bio') { artistsTried.delete(el.dataset.name); loadArtistInfo(el.dataset.name, true); }
    else if (action === 'bio-more') { $('#about-bio')?.classList.toggle('open'); el.textContent = $('#about-bio')?.classList.contains('open') ? 'Show less' : 'Read more'; }
    else if (action === 'organize') openOrganize();
    else if (action === 'upload') openUpload(el.dataset.folder || undefined);
    else if (action === 'jump') withAuth(() => player.jumpTo(Number(el.dataset.pos)));
    else if (action === 'dequeue') { e.stopPropagation(); player.removeAt(Number(el.dataset.pos)); }
    else if (action === 'clear-queue') player.clearUpNext();
    else if (action === 'save-lyrics') saveCurrentLyrics(el);
  };
  $('#main').addEventListener('click', onAction);
  const body = $('#sheet-body');
  body.addEventListener('click', onAction);
  body.addEventListener('click', onSettingsEvent);
  body.addEventListener('change', onSettingsEvent);
  body.addEventListener('submit', onSettingsSubmit);
  body.addEventListener('click', onUploadEvent);
  body.addEventListener('click', onOrganizeEvent);
  body.addEventListener('click', onFixEvent);
  body.addEventListener('click', onEditEvent);
  body.addEventListener('click', onMenuEvent);
  body.addEventListener('submit', onMenuEvent);
  body.addEventListener('click', onPlaylistMenuEvent);
  body.addEventListener('submit', onPlaylistMenuEvent);
  body.addEventListener('click', onSleepEvent);
  body.addEventListener('submit', onEditEvent);
  body.addEventListener('submit', onFixEvent);
  body.addEventListener('change', onOrganizeEvent);
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
  $('#cover-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || sheetKind !== 'edit') return;
    editState.coverBlob = f;
    editState.coverUrl = '';
    openEdit(editState.trackId, false);
  });
  wireDragDrop();

  $('#mini-open').addEventListener('click', () => setNowOpen(true));
  $('#np-close').innerHTML = ICON.down;
  $('#np-close').addEventListener('click', () => setNowOpen(false));
  $('#np-more').innerHTML = ICON.more;
  $('#np-info').innerHTML = ICON.info;
  const infoCurrent = () => { const t = player.current(); if (t) openTrackInfo(t.id); };
  $('#np-more').addEventListener('click', () => { const t = player.current(); if (t) openSongMenu(t.id); });
  $('#np-info').addEventListener('click', infoCurrent);
  $('#np-like').addEventListener('click', () => {
    const t = player.current();
    if (!t) return;
    const on = toggleLike(t.key);
    toast(on ? 'Added to Liked songs.' : 'Removed from Liked songs.');
  });
  $('#c-sleep').innerHTML = ICON.moon;
  $('#c-sleep').addEventListener('click', openSleep);
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
  player.setCrossfade(settings.crossfade);
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

// Keep Google access alive without a "Connect" button: any tap renews the
// token when it has expired or will soon (browsers only allow the sign-in
// popup during a tap). Also resumes a song that stopped for sign-in.
document.addEventListener('pointerdown', (e) => {
  if ($('#app').hidden || e.target.closest('#connect, .toast button')) return;
  const account = primaryAccount();
  if (!account) return;
  const expired = !hasToken(account);
  const soon = !expired && expiresSoon(account);
  if (!expired && !soon) return;
  if (soon && Date.now() - lastRefreshTry < 3 * 60e3) return;
  lastRefreshTry = Date.now();
  signIn({ account }).then(() => {
    hideToast();
    if (expired) {
      player.resumeAfterAuth();
      if (listSources().some((src) => srcState[src.id]?.status === 'auth')) refreshLibrary({ quiet: true });
    }
  }).catch(() => {});
}, { capture: true, passive: true });

// Swipe down to close Now Playing and bottom sheets (phones).
function swipeToClose(el, { canStart, onClose }) {
  let y0 = 0;
  let x0 = 0;
  let t0 = 0;
  let dy = 0;
  let mode = ''; // '' undecided, 'drag', 'ignore'
  const reset = () => {
    el.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1), opacity .25s ease';
    el.style.transform = '';
    el.style.opacity = '';
    setTimeout(() => { el.style.transition = ''; }, 260);
  };
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('input[type=range], .np-volume, .spectro, .shelf')) { mode = 'ignore'; return; }
    y0 = e.touches[0].clientY;
    x0 = e.touches[0].clientX;
    t0 = performance.now();
    dy = 0;
    mode = canStart(e) ? '' : 'ignore';
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (mode === 'ignore') return;
    const y = e.touches[0].clientY - y0;
    const x = e.touches[0].clientX - x0;
    if (!mode) {
      if (Math.abs(y) < 8 && Math.abs(x) < 8) return;
      mode = y > 0 && y > Math.abs(x) * 1.2 ? 'drag' : 'ignore';
      if (mode !== 'drag') return;
    }
    dy = Math.max(0, y);
    e.preventDefault();
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
    el.style.opacity = String(Math.max(0.35, 1 - dy / (window.innerHeight * 1.2)));
  }, { passive: false });
  el.addEventListener('touchend', () => {
    if (mode !== 'drag') { mode = ''; return; }
    mode = '';
    const speed = dy / Math.max(1, performance.now() - t0);
    if (dy > 120 || (dy > 40 && speed > 0.6)) {
      el.style.transition = 'transform .22s ease-in, opacity .22s ease-in';
      el.style.transform = `translateY(${window.innerHeight}px)`;
      el.style.opacity = '0';
      setTimeout(() => { onClose(); el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; }, 200);
    } else {
      reset();
    }
  });
}

swipeToClose($('#now'), {
  // Anywhere when the page is scrolled to the top (or on the top bar).
  canStart: (e) => nowOpen && (e.target.closest('.np-top') || $('.np-layout').scrollTop <= 0),
  onClose: () => setNowOpen(false),
});
swipeToClose($('#sheet'), {
  canStart: (e) => !!sheetKind && (e.target.closest('.sheet-head') || $('#sheet-body').scrollTop <= 0),
  onClose: () => closeSheet(),
});

// Read-only handle for debugging in the browser console.
window.n4cuply = { get lib() { return lib; }, scans, srcState, player };

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
player.on('sleep', updateSleepButton);
player.on('sleep-done', () => { updateSleepButton(); toast('Sleep timer: music stopped. Good night.'); });

boot();
