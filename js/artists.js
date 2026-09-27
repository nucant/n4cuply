// Artist photo and short bio from Wikipedia, cached on this device.
// Only fetched when online lookups are on (or the user asks on the artist page).
import { idbGet, idbPut } from './store.js';
import { looseArtist, primaryArtist } from './organize.js';

const TTL = 30 * 24 * 3600e3;
const CACHE_VERSION = 2; // bump when the stored shape changes
const MISS_TTL = 7 * 24 * 3600e3;
const MUSIC = /(singer|musician|rapper|\bdj\b|disc jockey|band|composer|duo|producer|songwriter|vocalist|qawwal|music|group|rock|pop|hip.hop|record|playback|trio)/i;

const mem = new Map(); // name -> info | null (loaded)

/**
 * Highest-quality image a browser can show: the original when it's a normal
 * web image, otherwise Wikimedia's largest standard rendering (e.g. for TIFFs).
 */
function bestImage(s) {
  const orig = s.originalimage;
  if (orig?.source && /\.(jpe?g|png|webp|gif)$/i.test(orig.source.split('?')[0]) && (orig.width || 0) <= 4000) return orig.source;
  const thumb = s.thumbnail?.source || '';
  if (!thumb) return orig?.source || '';
  const width = Math.min(orig?.width || 1920, 1920);
  const step = [1920, 1280, 960, 500, 330].find((w) => w <= width) || 330;
  return thumb.replace(/\/(lossy-page1-)?\d+px-/, (m, lossy) => `/${lossy || ''}${step}px-`);
}

/** Already-loaded info, for drawing without waiting. */
export const peekArtist = (name) => mem.get(name) || null;
/** True once we know the answer (photo or no photo) for this artist. */
export const artistKnown = (name) => mem.has(name);

async function wiki(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function lookup(name) {
  const q = primaryArtist(name);
  const search = await wiki('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', list: 'search', srsearch: `${q} music`, srlimit: '5', format: 'json', origin: '*',
  }));
  const hits = search?.query?.search || [];
  const want = looseArtist(q);
  const ordered = [...hits].sort((a, b) => (looseArtist(b.title.replace(/\s*\(.*\)$/, '')) === want) - (looseArtist(a.title.replace(/\s*\(.*\)$/, '')) === want));
  for (const hit of ordered.slice(0, 3)) {
    const title = hit.title.replace(/ /g, '_');
    const s = await wiki('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
    if (!s || s.type === 'disambiguation') continue;
    const sameName = looseArtist(s.title.replace(/\s*\(.*\)$/, '')) === want;
    if (!sameName && !looseArtist(s.title).includes(want)) continue;
    if (!MUSIC.test(`${s.description || ''} ${s.extract || ''}`)) continue;
    return {
      title: s.title,
      description: s.description || '',
      bio: s.extract || '',
      image: bestImage(s),
      thumb: s.thumbnail?.source || '',
      url: s.content_urls?.desktop?.page || '',
    };
  }
  return null;
}

/**
 * Resolves the artist's info or null. With online=false only the cache is used.
 */
export async function artistInfo(name, { online = false } = {}) {
  if (!name || name === 'Various Artists') return null;
  if (mem.has(name) && !online) return mem.get(name);
  const key = 'artist:' + name;
  let hit = await idbGet('lyrics', key);
  if (hit && hit.v !== CACHE_VERSION) hit = null;
  const fresh = hit && Date.now() - hit.at < (hit.data ? TTL : MISS_TTL);
  if (fresh || (hit && !online)) {
    mem.set(name, hit.data || null);
    return hit.data || null;
  }
  if (!online) return null;
  try {
    const data = await lookup(name);
    idbPut('lyrics', key, { data, at: Date.now(), v: CACHE_VERSION });
    mem.set(name, data);
    return data;
  } catch (e) {
    return hit?.data || null;
  }
}

/** Loads cached info for many artists (no network), so cards can show photos. */
export async function warmArtists(names) {
  await Promise.all(names.filter((n) => !mem.has(n)).map((n) => artistInfo(n, { online: false })));
}
