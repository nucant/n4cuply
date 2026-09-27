import { CONFIG } from './config.js';
import { initAuth, hasToken, expiresSoon, signIn, signOut } from './js/auth.js';
import { fetchBlob, AuthError } from './js/drive.js';
import { scanLibrary, prepare, loadCache, clearCache } from './js/library.js';
import { player } from './js/player.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M6 6l8.5 6L6 18zM16 6h2.2v12H16z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M18 6l-8.5 6L18 18zM5.8 6H8v12H5.8z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4h4v4M4 20L20 4M20 16v4h-4M14.5 14.5L20 20M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4"/></svg>',
  repeatOne: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4"/><path d="M11 10.5l1.5-1V15"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  spinner: '<svg viewBox="0 0 24 24" class="spin" aria-hidden="true"><path d="M12 3a9 9 0 109 9"/></svg>',
};

let lib = null;
let scanning = false;
let scanCount = 0;
let scanError = '';
let lists = {};
let installPrompt = null;
let lastRefreshTry = 0;

// ================= boot =================
async function boot() {
  registerServiceWorker();
  wireStaticUi();
  const cached = loadCache();
  if (cached) setLibrary(cached);

  try {
    await initAuth();
  } catch (e) {
    showLogin(e.message);
    return;
  }

  if (hasToken()) {
    showApp();
    if (!cached) refreshLibrary();
    else refreshLibrary({ quiet: true });
  } else if (cached) {
    // Library dekhai, gaan chalate gele login chaibe.
    showApp();
    toast('Gaan shunte abar connect koro.', { action: 'Connect', onAction: reconnect });
  } else {
    showLogin();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* stream chara-o cholbe */ });
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

/** Token sesh hole abar popup. Click handler theke call korte hobe. */
async function reconnect() {
  try {
    await signIn();
    hideToast();
    player.resumeAfterAuth();
    if (!lib || scanError) refreshLibrary();
  } catch (e) {
    toast(e.message);
  }
}

// ================= library =================
function setLibrary(raw) {
  lib = prepare(raw);
  player.restore(lib);
}

async function refreshLibrary({ quiet = false } = {}) {
  if (scanning) return;
  scanning = true;
  scanCount = 0;
  scanError = '';
  if (!quiet || !lib) render();
  try {
    const raw = await scanLibrary(CONFIG.driveFolderId, (n) => {
      scanCount = n;
      if (!lib) render();
    });
    const wasPlaying = player.current();
    lib = prepare(raw);
    if (!wasPlaying) player.restore(lib);
    if (!quiet) toast('Library update hoyeche.');
  } catch (e) {
    if (e instanceof AuthError) {
      toast(e.message, { action: 'Connect', onAction: reconnect });
    } else {
      scanError = e.message || 'Library load hoyni.';
    }
  } finally {
    scanning = false;
    render();
  }
}

// ================= routing =================
function route() {
  const m = location.hash.match(/^#album\/(.+)$/);
  return m ? { name: 'album', id: decodeURIComponent(m[1]) } : { name: 'home' };
}

window.addEventListener('hashchange', () => {
  render();
  $('#main').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
});

window.addEventListener('popstate', () => {
  setNowOpen(!!history.state?.now, false);
});

// ================= render =================
function render() {
  const main = $('#main');
  lists = {};
  const q = $('#q').value.trim().toLowerCase();

  if (!lib) {
    main.innerHTML = scanError ? errorBlock(scanError) : scanningBlock();
    return;
  }
  if (!lib.albums.length) {
    main.innerHTML = scanError ? errorBlock(scanError) : `
      <div class="empty">
        <h2>Ekhono kono gaan nei</h2>
        <p>"${esc(lib.rootName)}" folder-e mp3, m4a, wav ba flac file upload koro. Album-er jonno sub-folder banate paro.</p>
        <button class="btn primary" type="button" data-action="refresh">Abar check koro</button>
      </div>`;
    return;
  }

  if (q) main.innerHTML = renderSearch(q);
  else {
    const r = route();
    const album = r.name === 'album' ? lib.albumsById[r.id] : null;
    main.innerHTML = album ? renderAlbum(album) : renderHome();
  }
  hydrateArt(main);
  markPlaying();
}

function scanningBlock() {
  return `
    <div class="empty">
      <div class="loader">${ICON.spinner}</div>
      <h2>Drive-e gaan khujchi</h2>
      <p>${scanCount ? `${scanCount}-ta album pawa geche…` : 'Folder gulo dekhchi…'}</p>
    </div>`;
}

function errorBlock(msg) {
  return `
    <div class="empty">
      <h2>Library load hoyni</h2>
      <p>${esc(msg)}</p>
      <button class="btn primary" type="button" data-action="refresh">Abar try koro</button>
    </div>`;
}

function renderHome() {
  lists.all = lib.tracks;
  const n = lib.tracks.length;
  return `
    <section class="hero">
      <p class="eyebrow">${esc(lib.rootName)}</p>
      <h1>Tomar gaan</h1>
      <p class="meta">${lib.albums.length} album · ${n} gaan${scanning ? ' · update hocche…' : ''}</p>
      <div class="actions">
        <button class="btn primary" type="button" data-action="play-list" data-list="all">${ICON.play}<span>Sob chalao</span></button>
        <button class="btn" type="button" data-action="shuffle-list" data-list="all">${ICON.shuffle}<span>Shuffle</span></button>
      </div>
    </section>
    <section class="block">
      <h2 class="block-title">Album</h2>
      <div class="grid">${lib.albums.map(albumCard).join('')}</div>
    </section>
    <section class="block">
      <h2 class="block-title">Sob gaan</h2>
      <div class="tracks">${lib.tracks.map((t, i) => trackRow(t, 'all', i, { showAlbum: true })).join('')}</div>
    </section>`;
}

function renderAlbum(album) {
  const key = 'album';
  lists[key] = album.tracks;
  return `
    <div class="album-head">
      <button class="icon-btn back" type="button" data-action="home" aria-label="Pichone">${ICON.back}</button>
      <div class="art album-art" data-cover="${esc(album.cover || '')}" data-seed="${esc(album.name)}"></div>
      <div class="album-info">
        <p class="eyebrow">Album</p>
        <h1>${esc(album.name)}</h1>
        <p class="meta">${esc(album.path)} · ${album.tracks.length} gaan</p>
        <div class="actions">
          <button class="btn primary" type="button" data-action="play-list" data-list="${key}">${ICON.play}<span>Chalao</span></button>
          <button class="btn" type="button" data-action="shuffle-list" data-list="${key}">${ICON.shuffle}<span>Shuffle</span></button>
        </div>
      </div>
    </div>
    <div class="tracks">${album.tracks.map((t, i) => trackRow(t, key, i, { number: true })).join('')}</div>`;
}

function renderSearch(q) {
  const tracks = lib.tracks.filter((t) => t.title.toLowerCase().includes(q) || t.albumName.toLowerCase().includes(q));
  const albums = lib.albums.filter((a) => a.name.toLowerCase().includes(q));
  lists.search = tracks;
  if (!tracks.length && !albums.length) {
    return `<div class="empty"><h2>Kichu pawa jayni</h2><p>"${esc(q)}" namer kono gaan ba album nei.</p></div>`;
  }
  return `
    ${albums.length ? `<section class="block"><h2 class="block-title">Album</h2><div class="grid">${albums.map(albumCard).join('')}</div></section>` : ''}
    ${tracks.length ? `<section class="block"><h2 class="block-title">Gaan</h2><div class="tracks">${tracks.map((t, i) => trackRow(t, 'search', i, { showAlbum: true })).join('')}</div></section>` : ''}`;
}

function albumCard(a) {
  return `
    <a class="card" href="#album/${encodeURIComponent(a.id)}">
      <div class="art" data-cover="${esc(a.cover || '')}" data-seed="${esc(a.name)}"></div>
      <b>${esc(a.name)}</b>
      <small>${a.tracks.length} gaan</small>
    </a>`;
}

function trackRow(t, list, i, { showAlbum = false, number = false } = {}) {
  return `
    <button class="row" type="button" data-action="play-track" data-list="${list}" data-i="${i}" data-id="${esc(t.id)}">
      ${number ? `<span class="num">${t.n}</span>` : `<span class="art sm" data-cover="${esc(t.cover || '')}" data-seed="${esc(t.albumName)}"></span>`}
      <span class="row-text"><b>${esc(t.title)}</b>${showAlbum ? `<small>${esc(t.albumName)}</small>` : ''}</span>
      <span class="badge">${esc(t.ext)}</span>
    </button>`;
}

function markPlaying() {
  const cur = player.current();
  document.querySelectorAll('.row.is-current').forEach((el) => el.classList.remove('is-current'));
  if (!cur) return;
  document.querySelectorAll(`.row[data-id="${CSS.escape(cur.id)}"]`).forEach((el) => el.classList.add('is-current'));
}

// ================= artwork =================
const coverCache = new Map();

function coverUrl(id) {
  if (!id) return Promise.resolve(null);
  if (!coverCache.has(id)) {
    const p = fetchBlob(id).then((b) => URL.createObjectURL(b)).catch(() => {
      coverCache.delete(id);
      return null;
    });
    coverCache.set(id, p);
  }
  return coverCache.get(id);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function initials(s) {
  const words = String(s || '♪').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '♪') + (words[1]?.[0] || '')).toUpperCase();
}

function paintArt(el, seed, coverId) {
  const h = hash(seed || '');
  el.style.setProperty('--h1', h % 360);
  el.style.setProperty('--h2', (h >> 9) % 360);
  el.style.backgroundImage = '';
  el.classList.remove('has-img');
  el.innerHTML = `<span>${esc(initials(seed))}</span>`;
  el.dataset.want = coverId || '';
  if (!coverId) return Promise.resolve(null);
  return coverUrl(coverId).then((url) => {
    if (url && el.dataset.want === coverId) {
      el.style.backgroundImage = `url("${url}")`;
      el.classList.add('has-img');
      el.innerHTML = '';
    }
    return url;
  });
}

function hydrateArt(root) {
  root.querySelectorAll('.art[data-seed]').forEach((el) => paintArt(el, el.dataset.seed, el.dataset.cover));
}

// ================= player ui =================
function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updatePlayerUi() {
  const t = player.current();
  $('#mini').hidden = !t;
  document.body.classList.toggle('has-mini', !!t);
  if (!t) return;
  $('#mini-title').textContent = t.title;
  $('#mini-album').textContent = t.albumName;
  $('#now-title').textContent = t.title;
  $('#now-album').textContent = t.albumName;
  $('#now-from').textContent = t.albumName;
  paintArt($('#mini-art'), t.albumName, t.cover);
  paintArt($('#now-art'), t.albumName, t.cover).then((url) => { if (url) player.setArtwork(t.id, url); });
  $('#now').style.setProperty('--h1', hash(t.albumName) % 360);
  document.title = `${t.title} · ${CONFIG.appName}`;

  const s = player.state;
  $('#c-shuffle').innerHTML = ICON.shuffle;
  $('#c-shuffle').classList.toggle('on', s.shuffle);
  $('#c-shuffle').setAttribute('aria-pressed', String(s.shuffle));
  $('#c-repeat').innerHTML = s.repeat === 'one' ? ICON.repeatOne : ICON.repeat;
  $('#c-repeat').classList.toggle('on', s.repeat !== 'off');
  $('#c-repeat').setAttribute('aria-label', { off: 'Repeat off', all: 'Sob repeat', one: 'Ei gaan repeat' }[s.repeat]);
  renderUpNext();
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
function updateTime() {
  const a = player.audio;
  const d = a.duration;
  const pct = Number.isFinite(d) && d > 0 ? a.currentTime / d : 0;
  $('#mini-progress').style.width = (pct * 100).toFixed(2) + '%';
  if (!seeking) $('#seek').value = Math.round(pct * 1000);
  $('#seek').style.setProperty('--pct', ($('#seek').value / 10) + '%');
  $('#t-cur').textContent = fmt(seeking ? ($('#seek').value / 1000) * d : a.currentTime);
  $('#t-dur').textContent = fmt(d);
}

function renderUpNext() {
  const s = player.state;
  const items = s.order.slice(s.pos + 1, s.pos + 31).map((qi, k) => {
    const t = s.queue[qi];
    return `<button class="row" type="button" data-action="jump" data-pos="${s.pos + 1 + k}">
      <span class="art sm" data-seed="${esc(t.albumName)}" data-cover="${esc(t.cover || '')}"></span>
      <span class="row-text"><b>${esc(t.title)}</b><small>${esc(t.albumName)}</small></span>
    </button>`;
  });
  const box = $('#upnext-list');
  box.innerHTML = items.length ? items.join('') : `<p class="dim">${s.repeat === 'all' ? 'Queue abar prothom theke shuru hobe.' : 'Ei gaan-er por queue sesh.'}</p>`;
  hydrateArt(box);
}

let nowOpen = false;
function setNowOpen(open, push = true) {
  if (open === nowOpen) return;
  nowOpen = open;
  $('#now').hidden = !open;
  document.body.classList.toggle('now-open', open);
  if (push && open) history.pushState({ now: true }, '');
  else if (push && !open && history.state?.now) history.back();
}

player.on('change', updatePlayerUi);
player.on('state', updatePlayState);
player.on('time', updateTime);
player.on('auth', () => toast('Session sesh. Gaan chalate abar connect koro.', { action: 'Connect', onAction: reconnect }));
player.on('error', (e) => toast(e.detail));

// ================= events =================
function wireStaticUi() {
  $('#connect').addEventListener('click', connect);
  $('#q').addEventListener('input', () => render());

  $('#main').addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const list = lists[el.dataset.list] || [];
    if (action === 'play-track') withAuth(() => player.playList(list, Number(el.dataset.i), { shuffle: player.state.shuffle }));
    else if (action === 'play-list') withAuth(() => player.playList(list, 0, { shuffle: false }));
    else if (action === 'shuffle-list') withAuth(() => player.playList(list, 0, { shuffle: true, randomStart: true }));
    else if (action === 'home') goHome();
    else if (action === 'refresh') withAuth(() => refreshLibrary());
  });

  $('#upnext-list').addEventListener('click', (e) => {
    const el = e.target.closest('[data-action="jump"]');
    if (el) withAuth(() => player.jumpTo(Number(el.dataset.pos)));
  });

  $('#mini-open').addEventListener('click', () => setNowOpen(true));
  $('#now-close').innerHTML = ICON.down;
  $('#now-close').addEventListener('click', () => setNowOpen(false));
  $('#mini-next').innerHTML = ICON.next;
  $('#c-next').innerHTML = ICON.next;
  $('#c-prev').innerHTML = ICON.prev;

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
    const d = player.audio.duration;
    if (Number.isFinite(d)) player.seek((seek.value / 1000) * d);
    seeking = false;
  });

  // menu
  const menu = $('#menu');
  const menuBtn = $('#menu-btn');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); });
  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-menu]')?.dataset.menu;
    if (item === 'refresh') withAuth(() => refreshLibrary());
    if (item === 'install' && installPrompt) {
      installPrompt.prompt();
      installPrompt = null;
      menu.querySelector('[data-menu="install"]').hidden = true;
    }
    if (item === 'logout') logout();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('#menu [data-menu="install"]').hidden = false;
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) {
      if (e.key === 'Escape') { $('#q').value = ''; render(); $('#q').blur(); }
      return;
    }
    if (e.key === ' ') { e.preventDefault(); withAuth(() => player.toggle()); }
    else if (e.key === 'Escape' && nowOpen) setNowOpen(false);
  });

  $('.brand').addEventListener('click', (e) => { e.preventDefault(); $('#q').value = ''; goHome(); });
}

function goHome() {
  if (location.hash) location.hash = '';
  else render();
}

/**
 * Token thakle kaaj-ta kore. Na thakle (ba sesh hote chollo) ei click-er
 * bhetorei Google popup khole, login hole kaaj-ta kore.
 */
function withAuth(fn) {
  if (hasToken() && !expiresSoon()) return fn();
  if (hasToken()) {
    // Ekhono cholche, pichone notun token ene rakhi (5 minute-e ekbar).
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

boot();
