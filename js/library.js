// Drive folder scan kore library banay: gaan ache emon prottek folder = ekta album.
import { getFolder, listChildren, FOLDER_MIME } from './drive.js';

const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const COVER_RE = /^(cover|folder|front|album)\./i;
const CACHE_KEY = 'mp.library.v1';

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export async function scanLibrary(rootId, onProgress) {
  const root = await getFolder(rootId);
  const albums = [];

  async function walk(folder, trail) {
    const children = await listChildren(folder.id);
    const tracks = [];
    const subfolders = [];
    let cover = null;
    let coverScore = 0;

    for (const f of children) {
      const mime = f.mimeType || '';
      if (mime === FOLDER_MIME) {
        subfolders.push(f);
      } else if (mime.startsWith('audio/') || AUDIO_RE.test(f.name)) {
        tracks.push({ id: f.id, file: f.name, size: Number(f.size) || 0, mime: audioMime(f.name, mime) });
      } else if (mime.startsWith('image/') || IMAGE_RE.test(f.name)) {
        const score = COVER_RE.test(f.name) ? 2 : 1;
        if (score > coverScore) {
          cover = f.id;
          coverScore = score;
        }
      }
    }

    const path = [...trail, folder.name];
    if (tracks.length) {
      tracks.sort((a, b) => byName(a.file, b.file));
      albums.push({ id: folder.id, name: folder.name, path: path.join(' / '), cover, tracks, isRoot: folder.id === root.id });
      onProgress?.(albums.length);
    }
    await Promise.all(subfolders.map((s) => walk(s, path)));
  }

  await walk(root, []);
  albums.sort((a, b) => (b.isRoot - a.isRoot) || byName(a.name, b.name));
  const raw = { rootName: root.name, albums, scannedAt: Date.now() };
  saveCache(raw);
  return raw;
}

/** Raw library theke UI-r jonno track list, lookup table ityadi banay. */
export function prepare(raw) {
  const albumsById = {};
  const tracksById = {};
  const albums = raw.albums.map((a) => {
    const album = { ...a };
    album.tracks = a.tracks.map((t, i) => {
      const track = {
        ...t,
        title: cleanTitle(t.file),
        ext: (t.file.match(/\.([^.]+)$/) || [, ''])[1].toUpperCase(),
        n: i + 1,
        albumId: a.id,
        albumName: a.name,
        cover: a.cover,
      };
      tracksById[track.id] = track;
      return track;
    });
    albumsById[album.id] = album;
    return album;
  });
  const tracks = albums.flatMap((a) => a.tracks).sort((a, b) => byName(a.title, b.title));
  return { rootName: raw.rootName, scannedAt: raw.scannedAt, albums, albumsById, tracks, tracksById };
}

export function cleanTitle(file) {
  const t = file
    .replace(/\.[^.]+$/, '')
    .replace(/^\s*\d{1,3}\s*[-._)]\s*/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t || file;
}

function audioMime(name, mime) {
  if (mime && mime.startsWith('audio/')) return mime;
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  return {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm',
  }[ext] || 'audio/mpeg';
}

export function loadCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
    return raw && Array.isArray(raw.albums) ? raw : null;
  } catch (e) {
    return null;
  }
}

function saveCache(raw) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(raw)); } catch (e) { /* storage bhora */ }
}

export function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* storage bondho */ }
}
