// Music sources: the default Google Drive folder plus up to 5 more, each
// either a Drive folder (any signed-in Google account) or a folder on this PC.
// Also the one place that knows how to read a file from either kind.
import { CONFIG } from '../config.js';
import { accessToken, primaryAccount } from './auth.js';
import { fetchBlob, fetchRange } from './drive.js';
import { idbGet, idbPut, idbDelete } from './store.js';
import { settings } from './settings.js';

export const MAX_EXTRA = 5;
const KEY = 'mp.sources.v1';

let extra = load();

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(extra)); } catch (e) { /* storage unavailable */ }
}

export function defaultSource() {
  return { id: 'default', kind: 'drive', folderId: settings.folderId || CONFIG.driveFolderId, account: '', name: '', isDefault: true };
}

export function listSources() {
  return [defaultSource(), ...extra];
}

export function sourceById(id) {
  return listSources().find((s) => s.id === id) || null;
}

/** The Google account a Drive source uses ('' = the main signed-in account). */
export function accountOf(src) {
  return src?.account || primaryAccount();
}

export const canAddSource = () => extra.length < MAX_EXTRA;

export function addDriveSource({ folderId, account, name }) {
  if (!canAddSource()) throw new Error(`You can add up to ${MAX_EXTRA} extra sources.`);
  if (listSources().some((s) => s.kind === 'drive' && s.folderId === folderId && accountOf(s) === (account || primaryAccount()))) {
    throw new Error('That folder is already in your library.');
  }
  const src = { id: 'd' + Date.now().toString(36), kind: 'drive', folderId, account: account || '', name: name || 'Drive folder' };
  extra.push(src);
  save();
  return src;
}

export async function addLocalSource(handle) {
  if (!canAddSource()) throw new Error(`You can add up to ${MAX_EXTRA} extra sources.`);
  for (const s of extra) {
    if (s.kind !== 'local') continue;
    const h = await localHandle(s.id);
    if (h && (await h.isSameEntry?.(handle))) throw new Error('That folder is already in your library.');
  }
  const src = { id: 'l' + Date.now().toString(36), kind: 'local', name: handle.name };
  await idbPut('handles', src.id, handle);
  handles.set(src.id, handle);
  permission.set(src.id, 'granted');
  extra.push(src);
  save();
  return src;
}

export function updateSource(id, patch) {
  const s = extra.find((x) => x.id === id);
  if (s) { Object.assign(s, patch); save(); }
}

export function removeSource(id) {
  extra = extra.filter((s) => s.id !== id);
  save();
  handles.delete(id);
  idbDelete('handles', id);
  try { localStorage.removeItem('mp.files.v4.' + id); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- local folders
export const localSupported = () => typeof window.showDirectoryPicker === 'function';

const handles = new Map();     // srcId -> FileSystemDirectoryHandle
const permission = new Map();  // srcId -> 'granted' | 'prompt' | 'denied'
const fileHandles = new Map(); // fileId -> FileSystemFileHandle

export async function localHandle(srcId) {
  if (!handles.has(srcId)) {
    const h = await idbGet('handles', srcId);
    if (h) handles.set(srcId, h);
  }
  return handles.get(srcId) || null;
}

/** 'granted', 'prompt' (needs one click to allow again) or 'missing'. */
export async function localPermission(srcId) {
  const h = await localHandle(srcId);
  if (!h) return 'missing';
  try {
    const p = await h.queryPermission({ mode: 'read' });
    permission.set(srcId, p);
    return p;
  } catch (e) {
    return 'prompt';
  }
}

export const localPermissionCached = (srcId) => permission.get(srcId) || 'unknown';

/** Must be called from a click. Resolves true when access is allowed. */
export async function requestLocal(srcId) {
  const h = await localHandle(srcId);
  if (!h) return false;
  const p = await h.requestPermission({ mode: 'read' });
  permission.set(srcId, p);
  return p === 'granted';
}

export function rememberFileHandle(fileId, handle) {
  fileHandles.set(fileId, handle);
}

/** Local file id: "local:<srcId>:<path/inside/folder>" */
export const localId = (srcId, path) => `local:${srcId}:${path}`;

async function localFile(fileId) {
  let fh = fileHandles.get(fileId);
  if (!fh) {
    const [, srcId, ...rest] = fileId.split(':');
    const parts = rest.join(':').split('/');
    let dir = await localHandle(srcId);
    if (!dir) throw new Error('This PC folder was removed.');
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    fh = await dir.getFileHandle(parts[parts.length - 1]);
    fileHandles.set(fileId, fh);
  }
  return fh.getFile();
}

// ---------------------------------------------------------------- reading files
// A "ref" is { id, src } where src is the source id.

const accountFor = (ref) => accountOf(sourceById(ref.src));

export async function readRange(ref, start, end) {
  if (ref.id.startsWith('local:')) {
    const f = await localFile(ref.id);
    return f.slice(start, end + 1).arrayBuffer();
  }
  return fetchRange(ref.id, start, end, accountFor(ref));
}

export async function readBlob(ref) {
  if (ref.id.startsWith('local:')) return localFile(ref.id);
  return fetchBlob(ref.id, accountFor(ref));
}

/**
 * How the player should load a track, decided synchronously so playback can
 * start inside the user's tap:
 *   { mode: 'stream', url, blob }   stream through the service worker (blob() = fallback)
 *   { mode: 'blob', blob }          call blob() and play it
 *   { mode: 'auth', src, account }  Drive account needs signing in again
 *   { mode: 'local-permission', src } PC folder needs one click to allow
 */
export function playTarget(track) {
  const src = sourceById(track.src) || defaultSource();
  const ref = { id: track.id, src: src.id };
  if (src.kind === 'local') {
    const p = permission.get(src.id);
    if (p !== 'granted') return { mode: 'local-permission', src };
    return { mode: 'blob', blob: () => localFile(track.id) };
  }
  const account = accountOf(src);
  const token = accessToken(account);
  if (!token) return { mode: 'auth', src, account };
  const blob = () => readBlob(ref);
  if (navigator.serviceWorker?.controller) {
    const q = new URLSearchParams({ t: token, s: String(track.size || 0), m: track.mime || 'audio/mpeg' });
    return { mode: 'stream', url: `stream/${encodeURIComponent(track.id)}?${q}`, blob };
  }
  return { mode: 'blob', blob };
}

