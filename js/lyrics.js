// Lyrics: finds the best lyrics for a track and parses LRC timing.
// Sources, best first:
//   1. a .lrc file next to the song with the same name (e.g. "03 Song.lrc")
//   2. ID3 SYLT (synced lyrics frame) in MP3s
//   3. the lyrics tag (USLT / LYRICS / ©lyr), which may itself contain LRC timestamps
import { first } from './meta.js';
import { findLyrics } from './online.js';
import { idbGet, idbPut } from './store.js';

const TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
const toSec = (m, s) => Number(m) * 60 + Number(String(s).replace(':', '.'));

/**
 * Parses LRC (including "enhanced" LRC with <mm:ss.xx> word timings).
 * Returns { synced, lines: [{ t, text, words }] }.
 */
export function parseLrc(text) {
  const lines = [];
  const plain = [];
  let offset = 0;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    if (/^\[(ar|ti|al|au|by|length|re|ve|#):/i.test(line)) continue;

    const times = [];
    let rest = line;
    let m;
    TIME.lastIndex = 0;
    while ((m = /^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/.exec(rest))) {
      times.push(toSec(m[1], m[2]));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) {
      const clean = line.replace(TIME, '').replace(WORD, '').trim();
      plain.push(clean);
      continue;
    }
    let words = null;
    if (/<\d{1,3}:\d/.test(rest)) {
      words = [];
      const parts = rest.split(/(<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>)/);
      let t = null;
      for (const part of parts) {
        const wm = /^<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>$/.exec(part);
        if (wm) t = toSec(wm[1], wm[2]);
        else if (part) words.push({ t, text: part });
      }
    }
    WORD.lastIndex = 0;
    const clean = rest.replace(WORD, '').trim();
    for (const t of times) lines.push({ t, text: clean, words });
  }
  if (!lines.length) return { synced: false, lines: plain.map((text) => ({ t: null, text, words: null })) };
  for (const l of lines) {
    l.t = Math.max(0, l.t - offset);
    if (l.words) l.words = l.words.map((w) => ({ ...w, t: w.t == null ? null : Math.max(0, w.t - offset) }));
  }
  lines.sort((a, b) => a.t - b.t);
  return { synced: true, lines };
}

const cache = new Map();

/**
 * Resolves with { synced, lines, source } or null when the track has no lyrics.
 * loadText(fileId) must return the text of a Drive file.
 */
export function lyricsFor(track, loadText, { online = false } = {}) {
  if (!track) return Promise.resolve(null);
  const key = `${track.id}:${track.lrcId || ''}:${track.meta?.v || 0}:${online}`;
  if (!cache.has(key)) {
    cache.set(key, find(track, loadText)
      .catch(() => null)
      .then((found) => (found || !online ? found : fromOnline(track))));
  }
  return cache.get(key);
}

const ONLINE_RETRY = 7 * 24 * 3600e3; // don't ask again for a week after "not found"

async function fromOnline(track) {
  const key = `online:${track.id}`;
  let hit = await idbGet('lyrics', key);
  if (!hit || (hit.none && Date.now() - hit.at > ONLINE_RETRY)) {
    try {
      const ly = await findLyrics(track);
      hit = ly ? { text: ly.text, at: Date.now() } : { none: true, at: Date.now() };
      idbPut('lyrics', key, hit);
    } catch (e) {
      return null;
    }
  }
  if (!hit || hit.none) return null;
  const parsed = parseLrc(hit.text);
  return { ...parsed, source: 'LRCLIB (online, not saved yet)', online: true, rawText: hit.text };
}

async function find(track, loadText) {
  let fallback = null;
  if (track.lrcId) {
    const parsed = parseLrc(await loadText(track.lrcId));
    if (parsed.synced) return { ...parsed, source: '.lrc file' };
    if (parsed.lines.some((l) => l.text)) fallback = { ...parsed, source: '.lrc file' };
  }
  const sylt = track.meta?.syncedLyrics;
  if (sylt?.length) {
    return { synced: true, lines: sylt.map((l) => ({ t: l.t, text: l.text.trim(), words: null })), source: 'SYLT tag' };
  }
  const tag = first(track.meta, 'LYRICS');
  if (tag) {
    const parsed = parseLrc(tag);
    if (parsed.synced) return { ...parsed, source: 'Lyrics tag (LRC)' };
    if (!fallback) fallback = { ...parsed, source: 'Lyrics tag' };
  }
  return fallback;
}

/** Index of the line that should be highlighted at time t (seconds), or -1. */
export function activeLine(lines, t) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t + 0.15) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
