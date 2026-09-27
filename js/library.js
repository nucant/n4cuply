// Library: scans every source (Drive folders and PC folders), reads metadata,
// and builds albums, songs and artists across all of them.
import { getFolder, listChildren, FOLDER_MIME, AuthError } from './drive.js';
import { RangeReader, readMeta, META_VERSION, first, pickPicture, qualityTag } from './meta.js';
import { idbGetAll, idbPut, idbClear } from './store.js';
import { accountOf, localHandle, localPermission, localId, rememberFileHandle, readRange } from './sources.js';

const AUDIO_RE = /\.(mp3|m4a|m4b|mp4|aac|alac|wav|ogg|oga|opus|flac|webm)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const COVER_RE = /^(cover|folder|front|album)\./i;
const LRC_RE = /\.lrc$/i;
const baseName = (name) => name.replace(/\.[^.]+$/, '').toLowerCase();
const CACHE_PREFIX = 'mp.files.v4.';

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const norm = (s) => String(s || '').trim().toLowerCase();

/** Thrown when a PC folder needs one click to allow access again. */
export class LocalPermissionError extends Error {
  constructor(src) {
    super(`Allow access to "${src.name}" to use it.`);
    this.src = src;
  }
}

// ---------------------------------------------------------------- scan
const cacheTag = (src) => (src.kind === 'drive' ? `${src.folderId}|${accountOf(src)}` : src.id);

export async function scanSource(src, onProgress) {
  const scan = src.kind === 'local' ? await scanLocal(src, onProgress) : await scanDrive(src, onProgress);
  scan.tag = cacheTag(src);
  try { localStorage.setItem(CACHE_PREFIX + src.id, JSON.stringify(scan)); } catch (e) { /* storage full */ }
  return scan;
}

export function loadScanCache(src) {
  try {
    const scan = JSON.parse(localStorage.getItem(CACHE_PREFIX + src.id));
    return scan && scan.tag === cacheTag(src) && Array.isArray(scan.files) ? scan : null;
  } catch (e) {
    return null;
  }
}

async function scanDrive(src, onProgress) {
  const account = accountOf(src);
  const root = await getFolder(src.folderId, account);
  const files = [];
  const folders = {};

  async function walk(folder, trail) {
    const path = [...trail, folder.name];
    const children = await listChildren(folder.id, account);
    const info = { id: folder.id, name: folder.name, path: path.join(' / '), image: null, lrc: {}, src: src.id };
    let imageScore = 0;
    const subs = [];
    for (const f of children) {
      const mime = f.mimeType || '';
      if (mime === FOLDER_MIME) subs.push(f);
      else if (mime.startsWith('audio/') || AUDIO_RE.test(f.name)) {
        files.push({
          id: f.id, name: f.name, size: Number(f.size) || 0, mime: audioMime(f.name, mime),
          md5: f.md5Checksum || '', modified: f.modifiedTime || '', folderId: folder.id, src: src.id,
        });
      } else if (LRC_RE.test(f.name)) {
        info.lrc[baseName(f.name)] = f.id;
      } else if (mime.startsWith('image/') || IMAGE_RE.test(f.name)) {
        const score = COVER_RE.test(f.name) ? 2 : 1;
        if (score > imageScore) { info.image = f.id; imageScore = score; }
      }
    }
    folders[folder.id] = info;
    onProgress?.(files.length);
    await Promise.all(subs.map((s) => walk(s, path)));
  }

  await walk({ id: root.id, name: root.name }, []);
  return { srcId: src.id, kind: 'drive', rootId: root.id, rootName: root.name, files, folders, scannedAt: Date.now() };
}

async function scanLocal(src, onProgress) {
  const root = await localHandle(src.id);
  if (!root) throw new Error(`"${src.name}" is no longer available on this PC. Remove it in Settings and add it again.`);
  if ((await localPermission(src.id)) !== 'granted') throw new LocalPermissionError(src);
  const files = [];
  const folders = {};

  async function walk(dir, rel, trail) {
    const path = [...trail, dir.name];
    const folderId = localId(src.id, rel || '.');
    const info = { id: folderId, name: dir.name, path: path.join(' / '), image: null, lrc: {}, src: src.id };
    let imageScore = 0;
    const subs = [];
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${name}` : name;
      if (h.kind === 'directory') { subs.push([h, relPath]); continue; }
      const id = localId(src.id, relPath);
      if (AUDIO_RE.test(name)) {
        const f = await h.getFile();
        rememberFileHandle(id, h);
        files.push({
          id, name, size: f.size, mime: audioMime(name, f.type), md5: '',
          modified: new Date(f.lastModified).toISOString(), folderId, src: src.id,
        });
      } else if (LRC_RE.test(name)) {
        rememberFileHandle(id, h);
        info.lrc[baseName(name)] = id;
      } else if (IMAGE_RE.test(name)) {
        const score = COVER_RE.test(name) ? 2 : 1;
        if (score > imageScore) { rememberFileHandle(id, h); info.image = id; imageScore = score; }
      }
    }
    folders[folderId] = info;
    onProgress?.(files.length);
    for (const [h, relPath] of subs) await walk(h, relPath, path);
  }

  await walk(root, '', []);
  return { srcId: src.id, kind: 'local', rootId: localId(src.id, '.'), rootName: root.name, files, folders, scannedAt: Date.now() };
}

export function clearCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mp.files.')) localStorage.removeItem(k);
    }
  } catch (e) { /* ignore */ }
  idbClear('meta');
  idbClear('covers');
  metaMap.clear();
}

function audioMime(name, mime) {
  if (mime && mime.startsWith('audio/')) return mime;
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  return {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm',
  }[ext] || 'audio/mpeg';
}

// ---------------------------------------------------------------- metadata
const metaMap = new Map();
const metaKey = (f) => `${f.id}:${f.md5 || f.modified}:${f.size}`;

export async function loadMetaCache(files) {
  const all = await idbGetAll('meta');
  for (const f of files) {
    const m = all.get(metaKey(f));
    if (m && m.v === META_VERSION) metaMap.set(f.id, m);
  }
}

export const metaFor = (id) => metaMap.get(id) || null;

export function missingMeta(files) {
  return files.filter((f) => !metaMap.has(f.id));
}

const isPermissionError = (e) => e instanceof AuthError || e?.name === 'NotAllowedError' || e?.name === 'SecurityError';

/**
 * Reads file headers for every file without cached metadata, calling
 * onProgress as it goes. A source that needs signing in (or a PC folder that
 * needs permission) is skipped; its ids come back in the result.
 */
export async function readMissingMeta(files, onProgress, { concurrency = 4 } = {}) {
  const queue = missingMeta(files);
  const total = queue.length;
  const blocked = new Set();
  let done = 0;

  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      if (blocked.has(f.src)) continue;
      let m;
      try {
        const reader = new RangeReader((s, e) => readRange(f, s, e), f.size);
        m = await readMeta(reader, f.name);
      } catch (e) {
        if (isPermissionError(e)) { blocked.add(f.src); continue; }
        m = { v: META_VERSION, error: String(e.message || e), tags: {}, raw: [], pictures: [], extra: [], credits: [] };
      }
      metaMap.set(f.id, m);
      idbPut('meta', metaKey(f), m);
      done++;
      onProgress?.(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return { done, blocked: [...blocked] };
}

// ---------------------------------------------------------------- build
const refs = new Map(); // any file id (audio, image, lrc) -> source id

/** { id, src } for a file id seen in the last build, for reading it. */
export const refFor = (id) => ({ id, src: refs.get(id) || 'default' });

export function cleanTitle(file) {
  const t = file.replace(/\.[^.]+$/, '').replace(/^\s*\d{1,3}\s*[-._)]\s*/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t || file;
}

function mostCommon(list) {
  const counts = new Map();
  for (const x of list) if (x) counts.set(x, (counts.get(x) || 0) + 1);
  let best = '';
  let n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return { value: best, distinct: counts.size };
}

/**
 * scans: array of scan results (one per source). Albums never mix sources
 * (they're keyed by folder), but artists and songs span all of them.
 */
export function build(scans) {
  const albumsByKey = new Map();
  const tracksById = {};
  const tracks = [];
  const folders = {};
  refs.clear();
  for (const scan of scans) {
    for (const [id, fo] of Object.entries(scan.folders)) {
      folders[id] = fo;
      if (fo.image) refs.set(fo.image, scan.srcId);
      for (const lid of Object.values(fo.lrc || {})) refs.set(lid, scan.srcId);
    }
  }
  // PC copies first: when the same song is in Drive and in a synced PC folder,
  // play the local file (instant, works offline).
  const ordered = [...scans].sort((x, y) => (y.kind === 'local') - (x.kind === 'local'));
  const allFiles = ordered.flatMap((s) => s.files.map((f) => ({ ...f, src: f.src || s.srcId, rootName: s.rootName })));
  const seen = new Set();

  for (const f of allFiles) {
    // The same file can appear in two sources (a folder inside another); keep one.
    const same = `${f.name.toLowerCase()}|${f.size}`;
    if (tracksById[f.id] || seen.has(same)) continue;
    seen.add(same);
    refs.set(f.id, f.src);
    const folder = folders[f.folderId] || { name: f.rootName, path: f.rootName };
    const m = metaMap.get(f.id);
    const tagAlbum = first(m, 'ALBUM');
    const artist = first(m, 'ARTIST');
    const t = {
      id: f.id,
      src: f.src,
      file: f.name,
      size: f.size,
      mime: f.mime,
      modified: f.modified,
      folderId: f.folderId,
      path: folder.path,
      ext: (f.name.match(/\.([^.]+)$/) || [, ''])[1].toUpperCase(),
      meta: m || null,
      title: first(m, 'TITLE') || cleanTitle(f.name),
      artist,
      albumArtist: first(m, 'ALBUMARTIST') || artist,
      album: tagAlbum || folder.name,
      trackNo: parseInt(first(m, 'TRACKNUMBER'), 10) || 0,
      discNo: parseInt(first(m, 'DISCNUMBER'), 10) || 1,
      year: (first(m, 'DATE') || first(m, 'ORIGINALDATE')).slice(0, 4),
      genre: first(m, 'GENRE'),
      duration: m?.duration || 0,
      quality: qualityTag(m),
      hasPic: !!pickPicture(m),
      lrcId: folder.lrc?.[baseName(f.name)] || '',
    };
    t.albumKey = `${f.folderId}|${norm(tagAlbum)}`;
    tracksById[t.id] = t;
    tracks.push(t);
    if (!albumsByKey.has(t.albumKey)) albumsByKey.set(t.albumKey, { key: t.albumKey, folderId: f.folderId, src: f.src, tracks: [] });
    albumsByKey.get(t.albumKey).tracks.push(t);
  }

  const albums = [];
  for (const a of albumsByKey.values()) {
    a.tracks.sort((x, y) => (x.discNo - y.discNo) || ((x.trackNo || 999) - (y.trackNo || 999)) || byName(x.file, y.file));
    a.tracks.forEach((t, i) => { if (!t.trackNo) t.n = i + 1; else t.n = t.trackNo; });
    const t0 = a.tracks[0];
    const folder = folders[a.folderId];
    const aa = mostCommon(a.tracks.map((t) => t.albumArtist));
    a.name = t0.album;
    a.artist = aa.distinct > 1 ? 'Various Artists' : aa.value;
    a.year = a.tracks.map((t) => t.year).filter(Boolean).sort()[0] || '';
    a.genre = mostCommon(a.tracks.map((t) => t.genre)).value;
    a.duration = a.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    a.discs = Math.max(...a.tracks.map((t) => t.discNo));
    const q = mostCommon(a.tracks.map((t) => t.meta ? `${t.meta.codec || t.meta.format}${t.quality ? ' ' + t.quality : ''}` : ''));
    a.format = q.distinct > 1 ? 'Mixed formats' : q.value;
    a.hiRes = a.tracks.some((t) => t.meta?.hiRes);
    a.lossless = a.tracks.every((t) => t.meta?.lossless);
    a.label = first(t0.meta, 'LABEL');
    a.copyright = first(t0.meta, 'COPYRIGHT');
    const withPic = a.tracks.find((t) => t.hasPic);
    a.cover = withPic ? `pic:${withPic.id}` : folder?.image ? `file:${folder.image}` : '';
    a.id = a.key;
    for (const t of a.tracks) {
      t.albumName = a.name;
      t.cover = t.hasPic ? `pic:${t.id}` : a.cover;
      if (!t.artist) t.artist = a.artist || '';
    }
    albums.push(a);
  }
  albums.sort((x, y) => byName(x.name, y.name));

  const artistsByName = new Map();
  for (const t of tracks) {
    const name = t.albumArtist || t.artist;
    if (!name) continue;
    if (!artistsByName.has(name)) artistsByName.set(name, { name, tracks: [], albumKeys: new Set() });
    const ar = artistsByName.get(name);
    ar.tracks.push(t);
    ar.albumKeys.add(t.albumKey);
  }
  const artists = [...artistsByName.values()].map((ar) => ({
    ...ar,
    albums: albums.filter((al) => ar.albumKeys.has(al.key)),
    cover: albums.find((al) => ar.albumKeys.has(al.key) && al.cover)?.cover || '',
  })).sort((x, y) => byName(x.name, y.name));

  tracks.sort((x, y) => byName(x.title, y.title));
  const albumsById = Object.fromEntries(albums.map((a) => [a.key, a]));
  return { albums, albumsById, artists, tracks, tracksById, folders };
}
