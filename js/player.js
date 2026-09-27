// Player engine: queue, shuffle, repeat, crossfade / gapless, sleep timer,
// lock screen control.
//
// Two audio elements ("decks"): the current song plays on the active deck
// while the next one is prepared on the other, so it can crossfade in or start
// the moment the current one ends. Songs stream from Drive through the service
// worker (seeking works); without it the file is downloaded, then played.
import { AuthError } from './drive.js';
import { playTarget } from './sources.js';

const STATE_KEY = 'mp.player.v1';
const decks = [new Audio(), new Audio()];
for (const d of decks) d.preload = 'auto';
let active = 0;
const A = () => decks[active];
const B = () => decks[1 - active];

const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(detail === undefined ? new Event(type) : new CustomEvent(type, { detail }));

const state = {
  queue: [],
  order: [],
  pos: -1,
  shuffle: false,
  repeat: 'off', // off | all | one
  playing: false,
  loading: false,
  needsAuth: false,
  crossfade: 0,  // seconds; 0 = gapless hand-over only
  sleepAt: 0,    // timestamp, or -1 = at the end of this song
};

const blobUrls = [null, null];
let loadId = 0;
let fellBack = false;
let resumeAt = 0;
let artwork = null;
let lastSaved = 0;
let userVolume = 1;
let replayGain = 'off'; // off | track | album

// ---------- volume ----------
function gainFactor(track) {
  if (replayGain === 'off' || !track?.meta?.tags) return 1;
  const tags = track.meta.tags;
  const key = replayGain === 'album' && tags.REPLAYGAIN_ALBUM_GAIN ? 'REPLAYGAIN_ALBUM_GAIN' : 'REPLAYGAIN_TRACK_GAIN';
  const db = parseFloat(tags[key]?.[0]);
  // An <audio> element can't boost above 1, so only reductions apply.
  return Number.isFinite(db) ? Math.min(1, 10 ** (db / 20)) : 1;
}

const volumeFor = (track) => Math.max(0, Math.min(1, userVolume * gainFactor(track)));
let sleepFade = 1; // 1..0 while the sleep timer fades out

function applyVolume() {
  if (fade) return; // the fade sets volumes itself
  A().volume = volumeFor(current()) * sleepFade;
}

// ---------- helpers ----------
function current() {
  return state.pos >= 0 ? state.queue[state.order[state.pos]] || null : null;
}

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildOrder(startIndex) {
  const all = state.queue.map((_, i) => i);
  if (state.shuffle) {
    const rest = shuffled(all.filter((i) => i !== startIndex));
    state.order = startIndex >= 0 ? [startIndex, ...rest] : rest;
    state.pos = 0;
  } else {
    state.order = all;
    state.pos = Math.max(0, startIndex);
  }
}

function setLoading(v) {
  if (state.loading !== v) {
    state.loading = v;
    emit('state');
  }
}

function clearDeck(i) {
  const d = decks[i];
  d.pause();
  // No load() here: loading an empty source fires an "error" event, which
  // would look like the next song failing.
  d.removeAttribute('src');
  if (blobUrls[i]) {
    URL.revokeObjectURL(blobUrls[i]);
    blobUrls[i] = null;
  }
}

function seekWhenReady(deck, sec) {
  if (!sec) return;
  const apply = () => { try { deck.currentTime = sec; } catch (e) { /* ignore */ } };
  if (deck.readyState >= 1) apply();
  else deck.addEventListener('loadedmetadata', apply, { once: true });
}

// ---------- loading the current song ----------
let target = null; // how the current song is loaded (see sources.playTarget)

function needAuth(t, startAt) {
  resumeAt = startAt;
  state.needsAuth = true;
  setLoading(false);
  emit('auth', t);
}

function load(autoplay = true, startAt = 0) {
  cancelNext();
  const track = current();
  if (!track) return;
  const id = ++loadId;
  fellBack = false;
  artwork = null;
  updateMediaSession();
  emit('change');
  save(true);
  applyVolume();

  target = playTarget(track);
  if (target.mode === 'auth' || target.mode === 'local-permission') {
    needAuth(target, startAt);
    return;
  }
  state.needsAuth = false;
  setLoading(true);

  if (target.mode === 'stream') {
    clearDeck(active);
    A().src = target.url;
    seekWhenReady(A(), startAt);
    applyVolume();
    if (autoplay) A().play().catch(onPlayRejected);
    else setLoading(false);
  } else {
    loadBlob(track, id, autoplay, startAt);
  }
}

async function loadBlob(track, id, autoplay, startAt) {
  try {
    const blob = await target.blob();
    if (id !== loadId) return;
    clearDeck(active);
    blobUrls[active] = URL.createObjectURL(blob);
    A().src = blobUrls[active];
    seekWhenReady(A(), startAt);
    applyVolume();
    if (autoplay) await A().play();
    else setLoading(false);
  } catch (e) {
    if (id !== loadId) return;
    setLoading(false);
    if (e instanceof AuthError || (e.name === 'NotAllowedError' && track.id.startsWith('local:'))) {
      needAuth(playTarget(track), startAt);
    } else if (e.name !== 'NotAllowedError') {
      fail(`Couldn't play "${track.title}". ${e.message || ''}`);
    }
  }
}

function onPlayRejected(e) {
  // Browser blocked play() (autoplay rule); the user can press play.
  if (e && e.name === 'NotAllowedError') {
    setLoading(false);
    state.playing = false;
    emit('state');
  }
}

function fail(message) {
  emit('error', message);
}

// ---------- preparing the next song (crossfade / gapless) ----------
let upcoming = null; // { pos, track, ready, deck }
let fade = null;     // { start, ms, from, to, timer }

function nextPos() {
  if (state.repeat === 'one' || state.sleepAt === -1) return -1;
  if (state.pos < state.order.length - 1) return state.pos + 1;
  if (state.repeat === 'all' && !state.shuffle && state.order.length > 1) return 0;
  return -1;
}

async function prepareNext() {
  const pos = nextPos();
  if (pos < 0) return;
  const track = state.queue[state.order[pos]];
  const t = track && playTarget(track);
  if (!t || t.mode === 'auth' || t.mode === 'local-permission') return;
  const deck = 1 - active;
  upcoming = { pos, track, ready: false, deck, target: t, fellBack: false };
  const mine = upcoming;
  clearDeck(deck);
  try {
    if (t.mode === 'stream') {
      decks[deck].src = t.url;
    } else {
      const blob = await t.blob();
      if (upcoming !== mine) return;
      blobUrls[deck] = URL.createObjectURL(blob);
      decks[deck].src = blobUrls[deck];
    }
    decks[deck].volume = 0;
    decks[deck].load();
  } catch (e) {
    if (upcoming === mine) upcoming = null;
  }
}

/** The next song failed to stream: download it instead, once. Never retry in a loop. */
async function prepareFallback(up) {
  if (up.fellBack || !up.target?.blob) { up.failed = true; return; }
  up.fellBack = true;
  try {
    const blob = await up.target.blob();
    if (upcoming !== up) return;
    if (blobUrls[up.deck]) URL.revokeObjectURL(blobUrls[up.deck]);
    blobUrls[up.deck] = URL.createObjectURL(blob);
    decks[up.deck].src = blobUrls[up.deck];
    decks[up.deck].volume = 0;
  } catch (e) {
    up.failed = true;
  }
}

function cancelNext() {
  if (fade) {
    clearInterval(fade.timer);
    fade = null;
  }
  if (upcoming) {
    clearDeck(upcoming.deck);
    upcoming = null;
  }
}

/** Makes the prepared song the current one (after a fade or at the end). */
function handOver() {
  const old = active;
  active = upcoming.deck;
  state.pos = upcoming.pos;
  upcoming = null;
  if (fade) { clearInterval(fade.timer); fade = null; }
  clearDeck(old);
  fellBack = false;
  artwork = null;
  target = playTarget(current());
  applyVolume();
  updateMediaSession();
  emit('change');
  emit('state');
  save(true);
}

function startFade(seconds) {
  const incoming = decks[upcoming.deck];
  const ms = Math.max(200, seconds * 1000);
  const fromVol = A().volume;
  const toVol = volumeFor(upcoming.track) * sleepFade;
  incoming.volume = 0;
  incoming.play().catch(() => {});
  fade = {
    start: performance.now(),
    timer: setInterval(() => {
      const k = Math.min(1, (performance.now() - fade.start) / ms);
      // Equal-power curve: no loudness dip in the middle.
      A().volume = fromVol * Math.cos(k * Math.PI / 2);
      incoming.volume = toVol * Math.sin(k * Math.PI / 2);
      if (k >= 1) handOver();
    }, 40),
  };
}

function onTime() {
  const a = A();
  const d = a.duration;
  if (!Number.isFinite(d) || d <= 0 || a.paused) return;
  const left = d - a.currentTime;
  const fadeSec = Math.min(state.crossfade, Math.max(0, d / 3));
  if (!upcoming && !fade && left < Math.max(15, fadeSec + 10)) prepareNext();
  if (fadeSec > 0 && upcoming?.ready && !fade && left <= fadeSec) startFade(fadeSec);
}

// ---------- audio events ----------
for (const [i, deck] of decks.entries()) {
  const isActive = () => i === active;
  deck.addEventListener('playing', () => { if (isActive()) { state.playing = true; setLoading(false); emit('state'); } });
  deck.addEventListener('pause', () => { if (isActive() && !fade) { state.playing = false; emit('state'); save(true); } });
  deck.addEventListener('waiting', () => { if (isActive()) setLoading(true); });
  deck.addEventListener('canplay', () => {
    if (isActive()) setLoading(false);
    else if (upcoming && upcoming.deck === i) upcoming.ready = true;
  });
  deck.addEventListener('ended', () => { if (isActive()) onEnded(); });
  deck.addEventListener('timeupdate', () => {
    if (!isActive()) return;
    emit('time');
    updatePosition();
    onTime();
    if (Date.now() - lastSaved > 5000) save();
  });
  deck.addEventListener('durationchange', () => { if (isActive()) emit('time'); });
  deck.addEventListener('error', () => {
    if (!deck.getAttribute('src')) return; // cleared deck, not a real failure
    if (!isActive()) {
      if (upcoming && upcoming.deck === i) prepareFallback(upcoming);
      return;
    }
    onError();
  });
}

function onError() {
  const track = current();
  if (!track || !A().src) return;
  const at = A().currentTime || 0;
  setLoading(false);
  const now = playTarget(track);
  if (now.mode === 'auth' || now.mode === 'local-permission') {
    needAuth(now, at);
    return;
  }
  if (!fellBack && !blobUrls[active] && target?.blob) {
    // Streaming failed: download the whole file and try again.
    fellBack = true;
    setLoading(true);
    loadBlob(track, loadId, true, at);
    return;
  }
  fail(`Couldn't play "${track.title}". Check that the file isn't damaged.`);
}

function onEnded() {
  if (state.sleepAt === -1) {
    // Sleep timer: stop after this song.
    setSleep(0);
    cancelNext();
    emit('sleep-done');
    return;
  }
  if (state.repeat === 'one') {
    A().currentTime = 0;
    A().play().catch(onPlayRejected);
    return;
  }
  if (upcoming?.ready && !fade) {
    // Gapless-ish: the next song is already loaded; start it right away.
    const incoming = decks[upcoming.deck];
    incoming.volume = volumeFor(upcoming.track) * sleepFade;
    incoming.play().catch(onPlayRejected);
    handOver();
    return;
  }
  if (fade) return; // the fade finishes the hand-over
  next(true);
}

// ---------- public controls ----------
function playList(tracks, index = 0, opts = {}) {
  if (!tracks.length) return;
  state.queue = tracks.slice();
  if (typeof opts.shuffle === 'boolean') state.shuffle = opts.shuffle;
  const start = opts.shuffle && opts.randomStart ? Math.floor(Math.random() * tracks.length) : index;
  buildOrder(start);
  load(true);
}

function jumpTo(pos) {
  if (pos < 0 || pos >= state.order.length) return;
  state.pos = pos;
  load(true);
}

function toggle() {
  const track = current();
  if (!track) return;
  if (!A().src || state.needsAuth) {
    load(true, resumeAt || savedTime);
    return;
  }
  if (A().paused) A().play().catch(onPlayRejected);
  else {
    if (fade) cancelNext();
    A().pause();
  }
}

function next(auto = false) {
  if (!state.order.length) return;
  if (state.pos < state.order.length - 1) {
    state.pos += 1;
    load(true);
  } else if (state.repeat === 'all') {
    if (state.shuffle) buildOrder(-1);
    state.pos = 0;
    load(true);
  } else if (auto) {
    A().pause();
    A().currentTime = 0;
  }
}

function prev() {
  if (!state.order.length) return;
  if (A().currentTime > 3 || state.pos === 0) {
    cancelNext();
    A().currentTime = 0;
    return;
  }
  state.pos -= 1;
  load(true);
}

function seek(sec) {
  if (!Number.isFinite(sec)) return;
  cancelNext();
  A().currentTime = Math.max(0, sec);
}

function setShuffle(on) {
  const qi = state.order[state.pos] ?? -1;
  state.shuffle = on;
  if (state.queue.length) buildOrder(qi);
  cancelNext();
  emit('change');
  save(true);
}

function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  cancelNext();
  emit('change');
  save(true);
}

// ---------- queue editing ----------
/** Adds songs right after the current one (next = true) or at the end of the queue. */
function enqueue(tracks, { next: asNext = false } = {}) {
  if (!tracks.length) return;
  if (!current()) {
    playList(tracks, 0);
    return;
  }
  const base = state.queue.length;
  state.queue.push(...tracks);
  const idx = tracks.map((_, i) => base + i);
  if (asNext) state.order.splice(state.pos + 1, 0, ...idx);
  else state.order.push(...idx);
  cancelNext();
  emit('change');
  save(true);
}

/** Removes the song at an order position (not the current one). */
function removeAt(pos) {
  if (pos <= state.pos || pos >= state.order.length) return;
  state.order.splice(pos, 1);
  cancelNext();
  emit('change');
  save(true);
}

function clearUpNext() {
  state.order = state.order.slice(0, state.pos + 1);
  cancelNext();
  emit('change');
  save(true);
}

function setCrossfade(seconds) {
  state.crossfade = Math.max(0, Math.min(12, Number(seconds) || 0));
  cancelNext();
}

// ---------- sleep timer ----------
let sleepTimer = 0;
/** minutes > 0: stop after that long; 'end': stop after this song; 0: off. */
function setSleep(minutes) {
  clearInterval(sleepTimer);
  sleepFade = 1;
  if (minutes === 'end') {
    state.sleepAt = -1;
    cancelNext();
  } else if (minutes > 0) {
    state.sleepAt = Date.now() + minutes * 60e3;
    sleepTimer = setInterval(() => {
      const left = state.sleepAt - Date.now();
      if (left <= 0) {
        clearInterval(sleepTimer);
        cancelNext();
        A().pause();
        state.sleepAt = 0;
        sleepFade = 1;
        applyVolume();
        emit('sleep-done');
      } else if (left < 15e3) {
        sleepFade = left / 15e3; // gentle fade-out over the last 15 seconds
        applyVolume();
      }
      emit('sleep');
    }, 500);
  } else {
    state.sleepAt = 0;
  }
  applyVolume();
  emit('sleep');
}

/** After signing in again, resume the stuck song where it stopped. */
function resumeAfterAuth() {
  if (state.needsAuth && current()) load(true, resumeAt);
}

function setArtwork(trackId, url) {
  const track = current();
  if (track && track.id === trackId) {
    artwork = url;
    updateMediaSession();
  }
}

// ---------- lock screen / media keys ----------
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const track = current();
  if (!track) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || track.albumName,
    album: track.albumName,
    artwork: artwork ? [{ src: artwork, sizes: '512x512' }]
      : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
}

function updatePosition() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const a = A();
  const d = a.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration: d, position: Math.min(a.currentTime, d), playbackRate: a.playbackRate });
  } catch (e) { /* ignore */ }
}

if ('mediaSession' in navigator) {
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) { /* unsupported */ } };
  set('play', () => toggle());
  set('pause', () => A().pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', (d) => seek(d.seekTime));
  set('seekbackward', (d) => seek(A().currentTime - (d.seekOffset || 10)));
  set('seekforward', (d) => seek(A().currentTime + (d.seekOffset || 10)));
}

// ---------- save / restore ----------
let savedTime = 0;

function save(force = false) {
  if (!force && Date.now() - lastSaved < 5000) return;
  lastSaved = Date.now();
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      ids: state.queue.map((t) => t.id),
      order: state.order,
      pos: state.pos,
      shuffle: state.shuffle,
      repeat: state.repeat,
      time: A().src ? A().currentTime : savedTime,
    }));
  } catch (e) { /* storage unavailable */ }
}

/** After a library rebuild, swap queued tracks for their fresh objects. */
function relink(byId) {
  state.queue = state.queue.map((t) => byId[t.id] || t);
  emit('change');
}

/** Show last session's song in the mini player (does not auto-play). */
function restore(lib) {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { s = null; }
  if (!s) return;
  state.shuffle = !!s.shuffle;
  state.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
  const tracks = (s.ids || []).map((id) => lib.tracksById[id]);
  if (tracks.length && tracks.every(Boolean) && Array.isArray(s.order) && s.order.length <= tracks.length * 4) {
    state.queue = tracks;
    state.order = s.order.filter((i) => i >= 0 && i < tracks.length);
    state.pos = Math.min(Math.max(0, s.pos | 0), state.order.length - 1);
    savedTime = Number(s.time) || 0;
    resumeAt = savedTime;
  }
  emit('change');
}

function setVolume(v) {
  userVolume = Math.max(0, Math.min(1, v));
  applyVolume();
}

function setReplayGain(mode) {
  replayGain = mode;
  applyVolume();
}

export const player = {
  get audio() { return A(); },
  _decks: decks, // for debugging only
  state,
  current,
  on: (type, fn) => bus.addEventListener(type, fn),
  playList,
  jumpTo,
  toggle,
  next,
  prev,
  seek,
  setShuffle,
  cycleRepeat,
  enqueue,
  removeAt,
  clearUpNext,
  setCrossfade,
  setSleep,
  resumeAfterAuth,
  setArtwork,
  restore,
  relink,
  setVolume,
  setReplayGain,
};
