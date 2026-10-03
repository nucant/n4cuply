// Library clean-up: name matching, fix rules, and finding problems to fix.
//
// Rules are the user's decisions ("these artists are the same", "merge these
// albums", "use this cover"). They're applied every time the library is built,
// kept on this device, and synced to a JSON file in the default Drive folder so
// every device gets them.

export const RULES_FILE = 'n4cuply-library.json';
const KEY = 'mp.rules.v1';

// ---------------------------------------------------------------- names
/** Exact-ish key: case, spacing and trailing punctuation don't matter. */
export const artistKey = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();

const HONORIFICS = /^(ustad|ustaad|pandit|pt\.?|shri|sri|sir|dr\.?|mr\.?|ms\.?|mrs\.?|the)\s+/;
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Loose key for suggestions: also ignores titles like "Ustad", accents and punctuation. */
export function looseArtist(s) {
  let k = stripAccents(artistKey(s));
  while (HONORIFICS.test(k)) k = k.replace(HONORIFICS, '');
  return k.replace(/[^a-z0-9]+/g, '');
}

/** First credited artist of "A & B", "A feat. B", "A, B", "A x B". */
export function primaryArtist(s) {
  return String(s || '').split(/\s*(?:,|;|\/|\s&\s|\sand\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\s|\sx\s|\bwith\s)\s*/i)[0].trim();
}

export function looseAlbum(s) {
  return stripAccents(String(s || '').toLowerCase())
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(deluxe|remaster(ed)?|edition|expanded|bonus|anniversary|version|explicit|clean)\b/g, ' ')
    .replace(/\b(cd|disc|disk)\s*\d+\b/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/** Loose key for matching an .lrc to a song: no track number, case or punctuation. */
export function looseTitle(s) {
  return stripAccents(String(s || '').toLowerCase())
    .replace(/\.[a-z0-9]{2,4}$/, '')
    .replace(/^\s*(\d{1,3}\s*[-._)]?\s*)+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// ---------------------------------------------------------------- rules
function emptyRules() {
  return { v: 1, updatedAt: 0, artists: {}, albums: {}, covers: {}, tracks: {}, ignored: [], likes: {}, playlists: [] };
}

let rules = loadRules();
const listeners = new Set();

function loadRules() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && r.v === 1) return { ...emptyRules(), ...r };
  } catch (e) { /* storage unavailable */ }
  return emptyRules();
}

function saveRules() {
  try { localStorage.setItem(KEY, JSON.stringify(rules)); } catch (e) { /* storage unavailable */ }
}

function touch() {
  rules.updatedAt = Date.now();
  saveRules();
  for (const fn of listeners) fn(rules);
}

export const getRules = () => rules;
export const onRulesChange = (fn) => listeners.add(fn);

/**
 * Replace local rules with a newer copy (from Drive). Returns true if replaced.
 * keepPersonal (family members): take the admin's library fixes but keep this
 * person's own likes and playlists, which never go back to Drive.
 */
export function adoptRules(remote, { keepPersonal = false } = {}) {
  if (!remote || remote.v !== 1) return false;
  if (keepPersonal) {
    // Earlier versions copied the admin's name and photo to family members: drop that copy.
    if (rules.profile && JSON.stringify(rules.profile) === JSON.stringify(remote.profile || {})) {
      rules.profile = {};
      saveRules();
    }
    if (!(remote.updatedAt > (rules.remoteAt || 0))) return false;
    rules = { ...emptyRules(), ...remote, likes: rules.likes || {}, playlists: rules.playlists || [], profile: rules.profile || {}, updatedAt: rules.updatedAt, remoteAt: remote.updatedAt };
  } else {
    if (!(remote.updatedAt > rules.updatedAt)) return false;
    rules = { ...emptyRules(), ...remote };
  }
  saveRules();
  return true;
}

export function resetRules() {
  rules = emptyRules();
  touch();
}

export function mergeArtists(names, canonical) {
  for (const n of names) {
    const k = artistKey(n);
    if (k !== artistKey(canonical)) rules.artists[k] = canonical;
  }
  // Anything already pointing at a merged name follows it.
  for (const [k, v] of Object.entries(rules.artists)) {
    if (names.some((n) => artistKey(n) === artistKey(v))) rules.artists[k] = canonical;
  }
  delete rules.artists[artistKey(canonical)];
  touch();
}

export function mergeAlbums(keys, target) {
  for (const k of keys) if (k !== target) rules.albums[k] = target;
  touch();
}

export function setAlbumCover(albumKey, coverId) {
  rules.covers[albumKey] = coverId;
  touch();
}

/** Stable id for a song across devices and sources: file name + size. */
export const trackKeyOf = (fileName, size) => `${String(fileName).toLowerCase()}|${size}`;

/** Per-song fix: { title, artist, albumArtist, album, year, genre, trackNo, discNo, cover, source }. */
export function setTrackFix(key, fix) {
  rules.tracks[key] = { ...fix, at: Date.now() };
  touch();
}

/** Many fixes at once (one rebuild). */
export function setTrackFixes(map) {
  const at = Date.now();
  for (const [key, fix] of Object.entries(map)) rules.tracks[key] = { ...fix, at };
  if (Object.keys(map).length) touch();
}

export function clearTrackFix(key) {
  delete rules.tracks[key];
  touch();
}

export const trackFix = (key) => rules.tracks[key] || null;

// ---------------------------------------------------------------- profile
export const getProfile = () => rules.profile || {};

export function setProfile(patch) {
  rules.profile = { ...(rules.profile || {}), ...patch };
  touch();
}

// ---------------------------------------------------------------- likes & playlists
export const isLiked = (key) => !!rules.likes?.[key];

export function toggleLike(key) {
  rules.likes = rules.likes || {};
  if (rules.likes[key]) delete rules.likes[key];
  else rules.likes[key] = Date.now();
  touch();
  return !!rules.likes[key];
}

/** Likes many songs at once. Returns how many were newly liked. */
export function likeMany(keys) {
  rules.likes = rules.likes || {};
  let n = 0;
  const at = Date.now();
  keys.forEach((k, i) => { if (!rules.likes[k]) { rules.likes[k] = at + i; n++; } });
  if (n) touch();
  return n;
}

export const playlists = () => rules.playlists || [];

export function createPlaylist(name, keys = []) {
  const pl = { id: 'p' + Date.now().toString(36), name: name.trim() || 'New playlist', keys: [...new Set(keys)], at: Date.now() };
  rules.playlists = [...playlists(), pl];
  touch();
  return pl;
}

export function addToPlaylist(id, keys) {
  const pl = playlists().find((p) => p.id === id);
  if (!pl) return 0;
  const before = pl.keys.length;
  pl.keys = [...new Set([...pl.keys, ...keys])];
  pl.at = Date.now();
  touch();
  return pl.keys.length - before;
}

export function removeFromPlaylist(id, key) {
  const pl = playlists().find((p) => p.id === id);
  if (!pl) return;
  pl.keys = pl.keys.filter((k) => k !== key);
  touch();
}

export function removeManyFromPlaylist(id, keys) {
  const pl = playlists().find((p) => p.id === id);
  if (!pl) return;
  const drop = new Set(keys);
  pl.keys = pl.keys.filter((k) => !drop.has(k));
  touch();
}

export function renamePlaylist(id, name) {
  const pl = playlists().find((p) => p.id === id);
  if (pl && name.trim()) { pl.name = name.trim(); touch(); }
}

export function deletePlaylist(id) {
  rules.playlists = playlists().filter((p) => p.id !== id);
  touch();
}

/** A song's key changed (its file size changed after editing): move likes and playlist entries. */
export function rekeyTrack(oldKey, newKey) {
  if (oldKey === newKey) return;
  if (rules.likes?.[oldKey]) { rules.likes[newKey] = rules.likes[oldKey]; delete rules.likes[oldKey]; }
  for (const pl of playlists()) pl.keys = pl.keys.map((k) => (k === oldKey ? newKey : k));
  delete rules.tracks[oldKey];
  touch();
}

export function ignore(id) {
  if (!rules.ignored.includes(id)) rules.ignored.push(id);
  touch();
}

export function aliasArtist(name) {
  let n = name;
  for (let i = 0; i < 5; i++) {
    const next = rules.artists[artistKey(n)];
    if (!next || next === n) break;
    n = next;
  }
  return n;
}

export function albumTarget(key) {
  let k = key;
  for (let i = 0; i < 5 && rules.albums[k]; i++) k = rules.albums[k];
  return k;
}

// ---------------------------------------------------------------- analysis
/**
 * Finds what can be cleaned up. Returns
 *   { artists: [{ id, names: [{name, count}], canonical }],
 *     albums:  [{ id, albums: [album], target }],
 *     noCover: [album], noLyrics: [track] }
 */
export function analyze(lib, hasLyrics) {
  const ignored = new Set(rules.ignored);

  // Artists: union names whose loose keys match, whose first credit is another
  // artist, or that differ by a typo or two.
  const names = lib.artists.map((a) => ({ name: a.name, count: a.tracks.length, loose: looseArtist(a.name) }));
  const parent = names.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a, b) => { parent[find(a)] = find(b); };
  const byLoose = new Map();
  names.forEach((n, i) => {
    if (!n.loose) return;
    if (byLoose.has(n.loose)) join(i, byLoose.get(n.loose));
    else byLoose.set(n.loose, i);
  });
  names.forEach((n, i) => {
    const p = looseArtist(primaryArtist(n.name));
    if (p && p !== n.loose && byLoose.has(p)) join(i, byLoose.get(p));
  });
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i].loose;
      const b = names[j].loose;
      if (a.length >= 6 && b.length >= 6 && lev(a, b) <= (Math.min(a.length, b.length) >= 12 ? 2 : 1)) join(i, j);
    }
  }
  const groups = new Map();
  names.forEach((n, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n);
  });
  const artists = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      g.sort((x, y) => y.count - x.count || x.name.length - y.name.length);
      const id = 'artist:' + g.map((x) => artistKey(x.name)).sort().join('|');
      // Prefer the most-used name, but not a "feat." credit.
      const canonical = (g.find((x) => primaryArtist(x.name) === x.name) || g[0]).name;
      return { id, names: g.map(({ name, count }) => ({ name, count })), canonical };
    })
    .filter((g) => !ignored.has(g.id));

  // Albums with the same loose title and artist that are still separate.
  const albumGroups = new Map();
  for (const a of lib.albums) {
    const k = looseAlbum(a.name) + '|' + looseArtist(a.artist);
    if (!looseAlbum(a.name)) continue;
    if (!albumGroups.has(k)) albumGroups.set(k, []);
    albumGroups.get(k).push(a);
  }
  const albums = [...albumGroups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      g.sort((x, y) => y.tracks.length - x.tracks.length);
      return { id: 'album:' + g.map((a) => a.key).sort().join('|'), albums: g, target: g[0].key };
    })
    .filter((g) => !ignored.has(g.id));

  const noCover = lib.albums.filter((a) => !a.cover);
  const noLyrics = lib.tracks.filter((t) => !hasLyrics(t));
  return { artists, albums, noCover, noLyrics };
}
