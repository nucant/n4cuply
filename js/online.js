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
