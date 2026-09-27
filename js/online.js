// Optional online lookups, used only when the user turns them on:
//   lyrics from LRCLIB (lrclib.net), covers from Apple's iTunes Search API.
// Only artist, title, album and duration are sent, never audio.
import { looseAlbum, looseArtist, primaryArtist } from './organize.js';

const cleanTitle = (s) => String(s || '').replace(/\s*[([](feat|ft|with|prod)\.?[^)\]]*[)\]]/gi, '').replace(/\s+-\s+(remaster|live|radio edit).*$/i, '').trim();

async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lookup failed (${res.status}).`);
  return res.json();
}

function pickLyrics(j) {
  if (!j || j.instrumental) return null;
  if (j.syncedLyrics) return { text: j.syncedLyrics, synced: true };
  if (j.plainLyrics) return { text: j.plainLyrics, synced: false };
  return null;
}

/** Resolves { text, synced } or null. */
export async function findLyrics(track) {
  const artist = primaryArtist(track.artist || track.albumArtist);
  const title = cleanTitle(track.title);
  if (!artist || !title) return null;
  const q = new URLSearchParams({ artist_name: artist, track_name: title });
  if (track.album) q.set('album_name', track.album);
  if (track.duration) q.set('duration', String(Math.round(track.duration)));
  const exact = pickLyrics(await getJson('https://lrclib.net/api/get?' + q));
  if (exact) return exact;

  const list = await getJson('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: title, artist_name: artist })) || [];
  const close = list.filter((j) => !track.duration || !j.duration || Math.abs(j.duration - track.duration) <= 4);
  const best = close.find((j) => j.syncedLyrics) || close.find((j) => j.plainLyrics);
  return pickLyrics(best);
}

/** Resolves a cover image Blob for an album, or null. */
export async function findCover(album) {
  const artist = primaryArtist(album.artist === 'Various Artists' ? '' : album.artist);
  const term = `${artist} ${album.name}`.trim();
  const j = await getJson('https://itunes.apple.com/search?' + new URLSearchParams({ term, entity: 'album', limit: '10' }));
  const results = j?.results || [];
  const want = looseAlbum(album.name);
  const wantArtist = looseArtist(artist);
  const score = (r) => (looseAlbum(r.collectionName) === want ? 2 : looseAlbum(r.collectionName).includes(want) ? 1 : 0)
    + (!wantArtist || looseArtist(r.artistName).includes(wantArtist) ? 1 : 0);
  const best = results.map((r) => ({ r, s: score(r) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s)[0]?.r;
  if (!best?.artworkUrl100) return null;
  const url = best.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1200x1200bb.');
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.blob();
}

// ---------------------------------------------------------------- song info
/** What to search for: the song's tags, or a cleaned-up file name. */
export function searchTermFor(track) {
  const hasTags = track.meta?.tags?.TITLE && (track.artist || track.albumArtist);
  if (hasTags) return `${primaryArtist(track.artist || track.albumArtist)} ${cleanTitle(track.title)}`;
  return track.file
    .replace(/\.[^.]+$/, '')
    .replace(/^\s*\d{1,3}\s*[-._)]?\s*/, '')
    .replace(/[_]+/g, ' ')
    .replace(/[([](official|lyric|lyrics|audio|video|hd|hq|4k|full song|mp3|flac)[^)\]]*[)\]]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const hi = (url, size = 1200) => String(url || '').replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);

/** iTunes song matches: [{ title, artist, albumArtist, album, year, genre, trackNo, trackTotal, discNo, duration, cover, thumb, id }] */
export async function searchSongs(term) {
  if (!term) return [];
  const j = await getJson('https://itunes.apple.com/search?' + new URLSearchParams({ term, entity: 'song', limit: '15' }));
  return (j?.results || []).map((r) => ({
    id: r.trackId,
    title: r.trackName,
    artist: r.artistName,
    albumArtist: r.collectionArtistName || r.artistName,
    album: String(r.collectionName || '').replace(/\s+-\s+(single|ep)$/i, ''),
    year: String(r.releaseDate || '').slice(0, 4),
    genre: r.primaryGenreName || '',
    trackNo: r.trackNumber || 0,
    trackTotal: r.trackCount || 0,
    discNo: r.discNumber || 1,
    duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : 0,
    cover: hi(r.artworkUrl100),
    thumb: hi(r.artworkUrl100, 120),
  }));
}

const looseSong = (s) => looseAlbum(cleanTitle(s));

/** 0..100: how well a result fits this song (title, artist, length). */
export function matchScore(track, c) {
  let score = 0;
  const want = looseSong(track.meta?.tags?.TITLE ? track.title : searchTermFor(track));
  const got = looseSong(c.title);
  if (want && got) {
    if (want === got) score += 50;
    else if (want.includes(got) || got.includes(want)) score += 35;
  }
  const artist = looseArtist(primaryArtist(track.artist || track.albumArtist || ''));
  const cArtist = looseArtist(c.artist);
  if (artist && cArtist && (artist === cArtist || cArtist.includes(artist) || artist.includes(cArtist))) score += 30;
  else if (!artist && looseSong(track.file).includes(cArtist)) score += 20;
  if (track.duration && c.duration) {
    const d = Math.abs(track.duration - c.duration);
    score += d <= 2 ? 20 : d <= 5 ? 10 : d > 20 ? -30 : 0;
  }
  score = Math.max(0, Math.min(100, score));
  // Tie-breakers (fractions, so they never outweigh a real match):
  // the album the file already names, then originals over compilations.
  if (track.tagAlbum && looseAlbum(c.album) === looseAlbum(track.tagAlbum)) score += 0.5;
  if (!/greatest hits|best of|hits|collection|now that|ultimate|top \d+|essential|anthology|compilation/i.test(c.album)) score += 0.3;
  return score;
}

/** Good enough to apply without asking: title and artist both match. */
export const isConfident = (track, c) => c.score >= 80 && (!track.duration || !c.duration || Math.abs(track.duration - c.duration) <= 6);

/** Best matches first, each with .score. */
export async function findSongMatches(track, term) {
  const list = await searchSongs(term || searchTermFor(track));
  return list.map((c) => ({ ...c, score: matchScore(track, c) })).sort((a, b) => b.score - a.score);
}
