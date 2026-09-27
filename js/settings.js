// User settings, stored on this device.
import { CONFIG } from '../config.js';

const KEY = 'mp.settings.v1';
const DEFAULTS = {
  folderId: '',          // empty = CONFIG.driveFolderId
  replayGain: 'off',     // off | track | album
  dynamicColor: true,    // tint screens from album art
  showTech: true,        // "FLAC · 96 kHz · 24-bit" line on Now Playing
  lyricsPreview: true,   // current lyric line on Now Playing
  onlineLookup: false,   // LRCLIB lyrics / iTunes covers / Wikipedia artists
  writeTags: true,       // write edits into FLAC / MP3 files
  artistInfo: true,      // artist photos + bios from Wikipedia
  crossfade: 0,          // seconds between songs (0 = gapless hand-over)
  layout: 'auto',        // auto | phone | tablet | desktop
  playerStyle: 'default', // default | vinyl | cassette | vintage
  volume: 100,
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
}

export function musicFolderId() {
  return settings.folderId || CONFIG.driveFolderId;
}

/** Accepts a Drive folder link or a bare folder ID. Returns the ID or ''. */
export function parseFolderInput(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '';
}
