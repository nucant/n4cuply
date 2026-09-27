// Player engine: queue, shuffle, repeat, lock screen control.
// Songs stream from Drive through the service worker (seeking works).
// Without a service worker the whole file is downloaded, then played.
import { accessToken } from './auth.js';
import { fetchBlob, AuthError } from './drive.js';

const STATE_KEY = 'mp.player.v1';
const audio = new Audio();
audio.preload = 'auto';

const bus = new EventTarget();
const emit = (type) => bus.dispatchEvent(new Event(type));

const state = {
  queue: [],
  order: [],
  pos: -1,
  shuffle: false,
  repeat: 'off', // off | all | one
  playing: false,
  loading: false,
  needsAuth: false,
};

let loadId = 0;
let blobUrl = null;
let fellBack = false;
let resumeAt = 0;
let artwork = null;
let lastSaved = 0;
let userVolume = 1;
let replayGain = 'off'; // off | track | album

function gainFactor(track) {
  if (replayGain === 'off' || !track?.meta?.tags) return 1;
  const tags = track.meta.tags;
  const key = replayGain === 'album' && tags.REPLAYGAIN_ALBUM_GAIN ? 'REPLAYGAIN_ALBUM_GAIN' : 'REPLAYGAIN_TRACK_GAIN';
  const db = parseFloat(tags[key]?.[0]);
  // An <audio> element can't boost above 1, so only reductions apply.
  return Number.isFinite(db) ? Math.min(1, 10 ** (db / 20)) : 1;
}

function applyVolume() {
  audio.volume = Math.max(0, Math.min(1, userVolume * gainFactor(current())));
}

// ---------- helpers ----------
function current() {
  return state.pos >= 0 ? state.queue[state.order[state.pos]] || null : null;
}

function canStream() {
  return !!navigator.serviceWorker?.controller;
}

function streamUrl(track, token) {
  const q = new URLSearchParams({ t: token, s: String(track.size || 0), m: track.mime || 'audio/mpeg' });
  return `stream/${encodeURIComponent(track.id)}?${q}`;
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

function releaseBlob() {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
}

function seekWhenReady(sec) {
  if (!sec) return;
  const apply = () => { try { audio.currentTime = sec; } catch (e) { /* ignore */ } };
  if (audio.readyState >= 1) apply();
  else audio.addEventListener('loadedmetadata', apply, { once: true });
}

// ---------- loading ----------
function load(autoplay = true, startAt = 0) {
  const track = current();
  if (!track) return;
  const id = ++loadId;
  fellBack = false;
  artwork = null;
  updateMediaSession();
  emit('change');
  save(true);

  applyVolume();
  const token = accessToken();
  if (!token) {
    resumeAt = startAt;
    state.needsAuth = true;
    emit('auth');
    return;
  }
  state.needsAuth = false;
  setLoading(true);

  if (canStream()) {
    releaseBlob();
    audio.src = streamUrl(track, token);
    seekWhenReady(startAt);
    if (autoplay) audio.play().catch(onPlayRejected);
    else setLoading(false);
  } else {
    loadBlob(track, id, autoplay, startAt);
  }
}

async function loadBlob(track, id, autoplay, startAt) {
  try {
    const blob = await fetchBlob(track.id);
    if (id !== loadId) return;
    releaseBlob();
    blobUrl = URL.createObjectURL(blob);
    audio.src = blobUrl;
    seekWhenReady(startAt);
    if (autoplay) await audio.play();
    else setLoading(false);
  } catch (e) {
    if (id !== loadId) return;
    setLoading(false);
    if (e instanceof AuthError) {
      resumeAt = startAt;
      state.needsAuth = true;
      emit('auth');
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
  bus.dispatchEvent(new CustomEvent('error', { detail: message }));
}

// ---------- audio events ----------
audio.addEventListener('playing', () => { state.playing = true; setLoading(false); emit('state'); });
audio.addEventListener('pause', () => { state.playing = false; emit('state'); save(true); });
audio.addEventListener('waiting', () => setLoading(true));
audio.addEventListener('canplay', () => setLoading(false));
audio.addEventListener('ended', () => onEnded());
audio.addEventListener('timeupdate', () => {
  emit('time');
  updatePosition();
  if (Date.now() - lastSaved > 5000) save();
});
audio.addEventListener('durationchange', () => emit('time'));
audio.addEventListener('error', () => {
  const track = current();
  if (!track || !audio.src) return;
  const at = audio.currentTime || 0;
  setLoading(false);
  if (!accessToken()) {
    resumeAt = at;
    state.needsAuth = true;
    emit('auth');
    return;
  }
  if (!fellBack && !blobUrl) {
    // Streaming failed: download the whole file and try again.
    fellBack = true;
    setLoading(true);
    loadBlob(track, loadId, true, at);
    return;
  }
  fail(`Couldn't play "${track.title}". Check that the file isn't damaged.`);
});

function onEnded() {
  if (state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(onPlayRejected);
    return;
  }
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
  if (!audio.src || state.needsAuth) {
    load(true, resumeAt || savedTime);
    return;
  }
  if (audio.paused) audio.play().catch(onPlayRejected);
  else audio.pause();
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
    audio.pause();
    audio.currentTime = 0;
  }
}

function prev() {
  if (!state.order.length) return;
  if (audio.currentTime > 3 || state.pos === 0) {
    audio.currentTime = 0;
    return;
  }
  state.pos -= 1;
  load(true);
}

function seek(sec) {
  if (Number.isFinite(sec)) audio.currentTime = Math.max(0, sec);
}

function setShuffle(on) {
  const qi = state.order[state.pos] ?? -1;
  state.shuffle = on;
  if (state.queue.length) buildOrder(qi);
  emit('change');
  save(true);
}

function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  emit('change');
  save(true);
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
  const d = audio.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate });
  } catch (e) { /* ignore */ }
}

if ('mediaSession' in navigator) {
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) { /* unsupported */ } };
  set('play', () => toggle());
  set('pause', () => audio.pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', (d) => seek(d.seekTime));
  set('seekbackward', (d) => seek(audio.currentTime - (d.seekOffset || 10)));
  set('seekforward', (d) => seek(audio.currentTime + (d.seekOffset || 10)));
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
      time: audio.src ? audio.currentTime : savedTime,
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
  if (tracks.length && tracks.every(Boolean) && Array.isArray(s.order) && s.order.length === tracks.length) {
    state.queue = tracks;
    state.order = s.order;
    state.pos = Math.min(Math.max(0, s.pos | 0), tracks.length - 1);
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
  audio,
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
  resumeAfterAuth,
  setArtwork,
  restore,
  relink,
  setVolume,
  setReplayGain,
};
