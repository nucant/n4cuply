// Album covers: fetched from Drive, resized and cached on the device, and
// used to pick the theme tint.
import { readBlob, readRange } from './sources.js';
import { refFor } from './library.js';
import { pickPicture } from './meta.js';
import { idbGet, idbPut } from './store.js';

const mem = new Map(); // coverId -> Promise<{url, color}|null>
const ready = new Map(); // coverId -> {url, color} once loaded
const MAX_EDGE = 720;

/**
 * coverId: "pic:<trackId>" (picture embedded in the file) or "file:<imageFileId>".
 * getTrack: returns the track object for a trackId (for its metadata).
 */
export function loadCover(coverId, getTrack) {
  if (!coverId) return Promise.resolve(null);
  if (!mem.has(coverId)) {
    const p = load(coverId, getTrack).catch(() => null);
    mem.set(coverId, p);
    p.then((v) => { if (v) ready.set(coverId, v); else mem.delete(coverId); });
  }
  return mem.get(coverId);
}

async function load(coverId, getTrack) {
  const [kind, id] = coverId.split(/:(.+)/);
  let cacheKey = coverId;
  let pic = null;
  if (kind === 'pic') {
    const t = getTrack(id);
    pic = pickPicture(t?.meta);
    if (!pic) return null;
    cacheKey = `${coverId}:${t.modified}:${pic.len}`;
  }
  const cached = await idbGet('covers', cacheKey);
  if (cached?.blob) return { url: URL.createObjectURL(cached.blob), color: cached.color };

  let blob;
  if (kind === 'url') {
    const res = await fetch(id);
    if (!res.ok) return null;
    blob = await res.blob();
  } else if (kind === 'pic') {
    const t = getTrack(id);
    let bytes = new Uint8Array(await readRange({ id: t.id, src: t.src }, pic.off, pic.off + pic.len - 1));
    if (pic.unsync) bytes = deUnsync(bytes);
    blob = new Blob([bytes], { type: pic.mime || 'image/jpeg' });
  } else {
    blob = await readBlob(refFor(id));
  }
  const { small, color } = await shrinkAndColor(blob);
  idbPut('covers', cacheKey, { blob: small, color });
  return { url: URL.createObjectURL(small), color };
}

/** The cover if it's already loaded, so repaints don't flash a placeholder. */
export const peekCover = (coverId) => ready.get(coverId) || null;

function deUnsync(b) {
  const out = new Uint8Array(b.length);
  let w = 0;
  for (let i = 0; i < b.length; i++) {
    out[w++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, w);
}

async function shrinkAndColor(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const small = scale < 1
    ? await new Promise((res) => canvas.toBlob((b) => res(b || blob), 'image/jpeg', 0.88))
    : blob;

  const s = 40;
  const c2 = document.createElement('canvas');
  c2.width = s;
  c2.height = s;
  const x2 = c2.getContext('2d', { willReadFrequently: true });
  x2.drawImage(bmp, 0, 0, s, s);
  const data = x2.getImageData(0, 0, s, s).data;
  bmp.close?.();
  return { small, color: dominant(data) };
}

/** The most vivid dominant colour of an image: [hue 0-360, sat 0-1, light 0-1]. */
function dominant(data) {
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let ar = 0, ag = 0, ab = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    ar += r; ag += g; ab += b; n++;
    const [h, sat, l] = rgbToHsl(r, g, b);
    if (l < 0.1 || l > 0.92 || sat < 0.18) continue;
    // Colours covering more area win; saturation helps a little.
    const weight = (0.35 + sat) * (1 - Math.abs(l - 0.5));
    const bin = bins[Math.floor(h / 15) % 24];
    bin.w += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
  }
  // Count neighbouring bins too, so colours spread across a gradient still win.
  let bestI = 0;
  let bestScore = -1;
  for (let i = 0; i < 24; i++) {
    const score = bins[i].w + 0.6 * (bins[(i + 23) % 24].w + bins[(i + 1) % 24].w);
    if (score > bestScore) { bestScore = score; bestI = i; }
  }
  const best = bins[bestI];
  if (best.w > n * 0.02) return rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
  const [h, sat, l] = rgbToHsl(ar / n, ag / n, ab / n);
  return [h, Math.min(sat, 0.25), l];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** CSS variables from a tint: deep background, mid tone and a light accent. */
export function tintVars(color, seedHue = 250) {
  const [h, s] = color || [seedHue, 0.45, 0.4];
  const sat = Math.min(0.7, Math.max(0.18, s));
  return {
    '--tint-deep': `hsl(${h.toFixed(0)} ${(sat * 70).toFixed(0)}% 13%)`,
    '--tint': `hsl(${h.toFixed(0)} ${(sat * 85).toFixed(0)}% 26%)`,
    '--tint-mid': `hsl(${h.toFixed(0)} ${(sat * 90).toFixed(0)}% 38%)`,
    '--tint-soft': `hsl(${h.toFixed(0)} ${(sat * 100).toFixed(0)}% 78%)`,
  };
}

export function applyTint(el, color, seedHue) {
  for (const [k, v] of Object.entries(tintVars(color, seedHue))) el.style.setProperty(k, v);
}
