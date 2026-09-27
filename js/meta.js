// Reads tags and technical info from audio files.
// Never downloads the whole file: RangeReader fetches only the bytes it needs.
// Format: MP3 (ID3v2/v1, Xing/Info/VBRI, LAME), FLAC, OGG Vorbis/Opus,
// MP4/M4A (AAC, ALAC), WAV.

export const META_VERSION = 4;
const CHUNK = 64 * 1024;
const MAX_FETCH = 6 * 1024 * 1024; // never read more than this per file

// ---------------------------------------------------------------- reader
export class RangeReader {
  constructor(fetchRange, size) {
    this.fetchRange = fetchRange; // (start, endInclusive) => ArrayBuffer
    this.size = size;
    this.chunks = new Map();
    this.fetched = 0;
  }

  async bytes(off, len) {
    if (off < 0) off = 0;
    if (this.size) {
      if (off >= this.size) return new Uint8Array(0);
      len = Math.min(len, this.size - off);
    }
    if (len <= 0) return new Uint8Array(0);
    const first = Math.floor(off / CHUNK);
    const last = Math.floor((off + len - 1) / CHUNK);
    let run = null;
    const runs = [];
    for (let c = first; c <= last; c++) {
      if (this.chunks.has(c)) { run = null; continue; }
      if (run) run[1] = c; else { run = [c, c]; runs.push(run); }
    }
    for (const [a, b] of runs) {
      const start = a * CHUNK;
      let end = (b + 1) * CHUNK - 1;
      if (this.size) end = Math.min(end, this.size - 1);
      if (this.fetched + (end - start + 1) > MAX_FETCH) throw new Error('read limit');
      const buf = new Uint8Array(await this.fetchRange(start, end));
      this.fetched += buf.length;
      for (let c = a; c <= b; c++) {
        const s = (c - a) * CHUNK;
        this.chunks.set(c, buf.subarray(s, Math.min(s + CHUNK, buf.length)));
      }
    }
    const out = new Uint8Array(len);
    let w = 0;
    for (let c = first; c <= last; c++) {
      const chunk = this.chunks.get(c);
      if (!chunk) break;
      const from = c === first ? off - c * CHUNK : 0;
      if (from >= chunk.length) break;
      const piece = chunk.subarray(from, Math.min(chunk.length, from + (len - w)));
      out.set(piece, w);
      w += piece.length;
      if (w >= len || chunk.length < CHUNK) break; // got everything, or hit end of file
    }
    return w < len ? out.subarray(0, w) : out;
  }
}

// ---------------------------------------------------------------- bytes helpers
const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

const str = (b, s = 0, e = b.length) => latin1.decode(b.subarray(s, e));
const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u24 = (b, i) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
const u32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u32le = (b, i) => ((b[i + 3] << 24) >>> 0) + ((b[i + 2] << 16) | (b[i + 1] << 8) | b[i]);
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u64 = (b, i) => u32(b, i) * 4294967296 + u32(b, i + 4);
const u64le = (b, i) => u32le(b, i + 4) * 4294967296 + u32le(b, i);
const synchsafe = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const trimNul = (s) => s.replace(/\0+$/g, '').trim();

function deUnsync(b) {
  const out = new Uint8Array(b.length);
  let w = 0;
  for (let i = 0; i < b.length; i++) {
    out[w++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, w);
}

// ---------------------------------------------------------------- tag model
// Canonical key = Vorbis comment naam (uppercase).
const VORBIS_ALIASES = {
  'ALBUM ARTIST': 'ALBUMARTIST', 'ALBUM_ARTIST': 'ALBUMARTIST', TOTALTRACKS: 'TRACKTOTAL',
  TOTALDISCS: 'DISCTOTAL', UNSYNCEDLYRICS: 'LYRICS', UNSYNCED_LYRICS: 'LYRICS', ORGANIZATION: 'LABEL',
  PUBLISHER: 'LABEL', KEY: 'INITIALKEY', DESCRIPTION: 'COMMENT', YEAR: 'DATE', ENCODED_BY: 'ENCODEDBY',
  'ENCODED-BY': 'ENCODEDBY', TEMPO: 'BPM', CATALOG: 'CATALOGNUMBER', UPC: 'BARCODE', EAN: 'BARCODE',
};

const ID3_MAP = {
  TIT2: 'TITLE', TPE1: 'ARTIST', TPE2: 'ALBUMARTIST', TALB: 'ALBUM', TRCK: 'TRACKNUMBER',
  TPOS: 'DISCNUMBER', TDRC: 'DATE', TYER: 'DATE', TDOR: 'ORIGINALDATE', TORY: 'ORIGINALDATE',
  TCON: 'GENRE', TCOM: 'COMPOSER', TEXT: 'LYRICIST', TPE3: 'CONDUCTOR', TPE4: 'REMIXER',
  TPUB: 'LABEL', TCOP: 'COPYRIGHT', TBPM: 'BPM', TKEY: 'INITIALKEY', TMOO: 'MOOD', TIT1: 'GROUPING',
  GRP1: 'GROUPING', TLAN: 'LANGUAGE', TSRC: 'ISRC', TENC: 'ENCODEDBY', TSSE: 'ENCODER',
  TCMP: 'COMPILATION', TIT3: 'SUBTITLE', TDRL: 'RELEASEDATE', TSST: 'DISCSUBTITLE', TMED: 'MEDIA',
  TOPE: 'ORIGINALARTIST', TOAL: 'ORIGINALALBUM', WOAR: 'WEBSITE', TDEN: 'ENCODINGTIME',
};

const ID3V22 = {
  TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB', TRK: 'TRCK', TPA: 'TPOS', TYE: 'TYER',
  TCO: 'TCON', TCM: 'TCOM', COM: 'COMM', ULT: 'USLT', TEN: 'TENC', TSS: 'TSSE', TBP: 'TBPM',
  TXX: 'TXXX', PIC: 'APIC', TCP: 'TCMP', TKE: 'TKEY', TPB: 'TPUB', TCR: 'TCOP', TT1: 'TIT1',
  TT3: 'TIT3', TP3: 'TPE3', TP4: 'TPE4', TXT: 'TEXT', TLA: 'TLAN', TRC: 'TSRC', TOR: 'TORY',
};

const MP4_MAP = {
  '©nam': 'TITLE', '©ART': 'ARTIST', aART: 'ALBUMARTIST', '©alb': 'ALBUM', '©day': 'DATE',
  '©gen': 'GENRE', '©wrt': 'COMPOSER', '©cmt': 'COMMENT', '©lyr': 'LYRICS', '©too': 'ENCODER',
  '©grp': 'GROUPING', cprt: 'COPYRIGHT', '©enc': 'ENCODEDBY', '©st3': 'SUBTITLE', desc: 'COMMENT',
};

export const GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];

function newResult(format) {
  return {
    v: META_VERSION, format, container: '', codec: '', lossless: false, sampleRate: 0, bitDepth: 0,
    channels: 0, channelMode: '', bitrate: 0, bitrateMode: '', duration: 0, samples: 0, encoder: '',
    tagType: '', extra: [], tags: {}, raw: [], pictures: [], credits: [], audioOffset: 0,
  };
}

function addTag(r, key, value, rawKey) {
  if (value == null) return;
  const v = String(value).replace(/\0+$/g, '').trim();
  if (!v) return;
  let k = key.toUpperCase().trim();
  k = VORBIS_ALIASES[k] || k;
  if (k.startsWith('MUSICBRAINZ ')) k = 'MUSICBRAINZ_' + k.slice(12).replace(/\s+/g, '').toUpperCase();
  if (k === 'TRACKNUMBER' || k === 'DISCNUMBER') {
    const [n, t] = v.split('/');
    if (n && n.trim()) push(r.tags, k, n.trim());
    if (t && t.trim()) push(r.tags, k === 'TRACKNUMBER' ? 'TRACKTOTAL' : 'DISCTOTAL', t.trim());
  } else {
    push(r.tags, k, v);
  }
  r.raw.push([rawKey || key, v]);
}

function push(obj, k, v) {
  if (!obj[k]) obj[k] = [];
  if (!obj[k].includes(v)) obj[k].push(v);
}

function parseVorbisComment(r, b, off = 0) {
  const vendorLen = u32le(b, off);
  r.encoder = r.encoder || trimNul(utf8.decode(b.subarray(off + 4, off + 4 + vendorLen)));
  let p = off + 4 + vendorLen;
  const count = u32le(b, p);
  p += 4;
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = u32le(b, p);
    p += 4;
    const s = utf8.decode(b.subarray(p, p + len));
    p += len;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const key = s.slice(0, eq);
    const val = s.slice(eq + 1);
    if (key.toUpperCase() === 'METADATA_BLOCK_PICTURE') {
      r.raw.push([key, '(embedded picture, base64)']);
      continue;
    }
    addTag(r, key, val, key);
  }
}

// ---------------------------------------------------------------- entry
/**
 * @param {RangeReader} reader
 * @param {string} name file name (used for format hints)
 */
export async function readMeta(reader, name = '') {
  const head = await reader.bytes(0, 64);
  const magic = str(head, 0, 4);
  let r;
  if (magic === 'fLaC') r = await parseFlac(reader, 0);
  else if (magic === 'OggS') r = await parseOgg(reader);
  else if (magic === 'RIFF' && str(head, 8, 12) === 'WAVE') r = await parseWav(reader);
  else if (str(head, 4, 8) === 'ftyp') r = await parseMp4(reader);
  else if (str(head, 0, 3) === 'ID3') {
    r = newResult('MP3');
    const end = await parseId3v2(reader, 0, r);
    const after = await reader.bytes(end, 4);
    if (str(after, 0, 4) === 'fLaC') {
      const fr = await parseFlac(reader, end);
      mergeTags(fr, r);
      r = fr;
    } else {
      await parseMpeg(reader, end, r);
    }
  } else {
    r = newResult('MP3');
    await parseMpeg(reader, 0, r);
    if (!r.sampleRate) throw new Error('Unknown format: ' + name);
  }
  if (r.format === 'MP3' && !Object.keys(r.tags).length) await parseId3v1(reader, r);
  finish(r, reader.size);
  return r;
}

function mergeTags(into, from) {
  for (const [k, vals] of Object.entries(from.tags)) for (const v of vals) push(into.tags, k, v);
  into.raw.push(...from.raw);
  into.pictures.push(...from.pictures);
  into.credits.push(...from.credits);
  if (!into.tagType) into.tagType = from.tagType;
}

function finish(r, size) {
  if (!r.duration && r.samples && r.sampleRate) r.duration = r.samples / r.sampleRate;
  if (r.duration > 0 && size) {
    const audioBytes = Math.max(0, size - (r.audioOffset || 0));
    const avg = Math.round((audioBytes * 8) / r.duration / 1000);
    if (!r.bitrate || r.lossless || r.bitrateMode !== 'CBR') r.bitrate = avg;
  }
  if (!r.channelMode && r.channels) {
    r.channelMode = { 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' }[r.channels] || `${r.channels} ch`;
  }
  r.hiRes = r.lossless && (r.bitDepth >= 24 || r.sampleRate > 48000);
  if (r.lossless && r.bitDepth && r.sampleRate && r.channels && r.duration && size) {
    const pcm = r.sampleRate * r.channels * (r.bitDepth / 8) * r.duration;
    if (r.codec !== 'PCM') r.extra.push(['Compression', `${Math.round((size / pcm) * 100)}% of WAV size`]);
  }
}

// ---------------------------------------------------------------- ID3
async function parseId3v2(reader, off, r) {
  const h = await reader.bytes(off, 10);
  if (str(h, 0, 3) !== 'ID3') return off;
  const ver = h[3];
  const flags = h[5];
  const size = synchsafe(h, 6);
  const end = off + 10 + size + (flags & 0x10 ? 10 : 0);
  r.tagType = `ID3v2.${ver}`;
  const tagUnsync = !!(flags & 0x80);
  let p = off + 10;

  if (flags & 0x40 && ver >= 3) {
    const eh = await reader.bytes(p, 4);
    p += ver === 3 ? 4 + u32(eh, 0) : synchsafe(eh, 0);
  }

  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  const limit = off + 10 + size;

  while (p + hdrLen <= limit) {
    const fh = await reader.bytes(p, hdrLen);
    let id = str(fh, 0, idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let fsize;
    let fflags = 0;
    if (ver === 2) fsize = u24(fh, 3);
    else if (ver === 3) fsize = u32(fh, 4);
    else fsize = synchsafe(fh, 4);
    if (ver >= 3) fflags = u16(fh, 8);
    const dataStart = p + hdrLen;
    p = dataStart + fsize;
    if (fsize <= 0 || p > limit + 1) break;
    if (ver === 2) id = ID3V22[id] || id;

    let skip = 0;
    let frameUnsync = tagUnsync;
    if (ver === 3) {
      if (fflags & 0x0080 || fflags & 0x0040) continue; // compressed / encrypted
      if (fflags & 0x0020) skip += 1;
    } else if (ver === 4) {
      if (fflags & 0x0008 || fflags & 0x0004) continue;
      if (fflags & 0x0040) skip += 1;
      if (fflags & 0x0001) skip += 4;
      frameUnsync = !!(fflags & 0x0002) || tagUnsync;
    }

    if (id === 'APIC') {
      const headBytes = await reader.bytes(dataStart + skip, Math.min(fsize - skip, 512));
      const hb = frameUnsync ? deUnsync(headBytes) : headBytes;
      const pic = parseApicHeader(hb, ver);
      if (pic && !frameUnsync) {
        r.pictures.push({ ...pic, off: dataStart + skip + pic.dataOff, len: fsize - skip - pic.dataOff });
      } else if (pic) {
        r.pictures.push({ ...pic, off: dataStart + skip + pic.dataOff, len: fsize - skip - pic.dataOff, unsync: true });
      }
      continue;
    }
    if (fsize > 256 * 1024) continue; // skip other large frames (GEOB, PRIV)
    let data = await reader.bytes(dataStart + skip, fsize - skip);
    if (frameUnsync) data = deUnsync(data);
    readId3Frame(r, id, data, ver);
  }

  if (r.tags.DATE && ver === 3) {
    // TYER + TDAT (DDMM)
  }
  return end;
}

function decodeText(b, enc) {
  if (enc === 0) return latin1.decode(b);
  if (enc === 3) return utf8.decode(b);
  if (enc === 2) return utf16be.decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return utf16be.decode(b.subarray(2));
  if (b[0] === 0xff && b[1] === 0xfe) return utf16le.decode(b.subarray(2));
  return utf16le.decode(b);
}

function termLen(enc) { return enc === 1 || enc === 2 ? 2 : 1; }

function findTerm(b, from, enc) {
  const w = termLen(enc);
  for (let i = from; i + w <= b.length; i += w) {
    if (b[i] === 0 && (w === 1 || b[i + 1] === 0)) return i;
  }
  return b.length;
}

function splitValues(s) {
  return s.split('\0').map((x) => x.trim()).filter(Boolean);
}

function readId3Frame(r, id, b, ver) {
  if (!b.length) return;
  if (id[0] === 'T' && id !== 'TXXX') {
    const vals = splitValues(decodeText(b.subarray(1), b[0]));
    if (id === 'TCON') {
      vals.forEach((v) => {
        const m = /^\((\d+)\)(.*)$/.exec(v);
        const g = m ? (m[2] || GENRES[+m[1]] || v) : /^\d+$/.test(v) ? GENRES[+v] || v : v;
        addTag(r, 'GENRE', g, 'TCON');
      });
      return;
    }
    if (id === 'TIPL' || id === 'TMCL') {
      for (let i = 0; i + 1 < vals.length; i += 2) {
        r.credits.push([vals[i], vals[i + 1]]);
        const role = vals[i].toUpperCase();
        if (['PRODUCER', 'ENGINEER', 'MIX', 'MIXER', 'DJ-MIX', 'ARRANGER'].includes(role)) {
          addTag(r, role === 'MIX' ? 'MIXER' : role, vals[i + 1], id);
        } else {
          addTag(r, 'PERFORMER', `${vals[i + 1]} (${vals[i]})`, id);
        }
      }
      return;
    }
    const key = ID3_MAP[id];
    vals.forEach((v) => (key ? addTag(r, key, v, id) : r.raw.push([id, v])));
    return;
  }
  if (id === 'TXXX') {
    const enc = b[0];
    const t = findTerm(b, 1, enc);
    const desc = decodeText(b.subarray(1, t), enc).trim();
    const val = decodeText(b.subarray(t + termLen(enc)), enc);
    splitValues(val).forEach((v) => addTag(r, desc, v, 'TXXX:' + desc));
    return;
  }
  if (id === 'COMM' || id === 'USLT') {
    const enc = b[0];
    const lang = str(b, 1, 4);
    const t = findTerm(b, 4, enc);
    const desc = decodeText(b.subarray(4, t), enc).trim();
    const text = decodeText(b.subarray(t + termLen(enc)), enc).replace(/\0+$/, '');
    if (id === 'COMM' && /^(iTun|Songs-DB|MusicMatch)/.test(desc)) {
      r.raw.push([`COMM:${desc}`, text.trim()]);
      return;
    }
    addTag(r, id === 'USLT' ? 'LYRICS' : 'COMMENT', text, `${id}${desc ? ':' + desc : ''}${lang && lang !== 'XXX' ? ' [' + lang + ']' : ''}`);
    return;
  }
  if (id === 'UFID') {
    const t = findTerm(b, 0, 0);
    const owner = latin1.decode(b.subarray(0, t));
    const val = latin1.decode(b.subarray(t + 1));
    if (/musicbrainz/i.test(owner)) addTag(r, 'MUSICBRAINZ_TRACKID', val, 'UFID');
    else r.raw.push(['UFID:' + owner, val]);
    return;
  }
  if (id === 'SYLT') {
    const lines = parseSylt(b);
    if (lines.length) {
      r.syncedLyrics = lines;
      r.hasSyncedLyrics = true;
    }
    r.raw.push(['SYLT', `(synced lyrics, ${lines.length} lines)`]);
    return;
  }
  if (id[0] === 'W' && id !== 'WXXX') {
    r.raw.push([id, latin1.decode(b).replace(/\0+$/, '')]);
    return;
  }
  if (id === 'PCNT' || id === 'POPM') {
    if (id === 'POPM') {
      const t = findTerm(b, 0, 0);
      const rating = b[t + 1];
      if (rating) r.raw.push(['POPM (rating)', `${Math.round((rating / 255) * 5 * 10) / 10} / 5`]);
    }
    return;
  }
  if (!['PRIV', 'GEOB', 'MCDI', 'RVA2', 'RVAD', 'EQU2', 'ETCO', 'MLLT', 'SYTC', 'AENC', 'LINK', 'POSS', 'OWNE', 'COMR', 'ENCR', 'GRID', 'SIGN', 'SEEK', 'ASPI', 'CHAP', 'CTOC'].includes(id)) {
    r.raw.push([id, `(${b.length} bytes)`]);
  } else if (id === 'MCDI') {
    r.raw.push(['MCDI', 'CD TOC']);
  }
}

// SYLT: enc, lang(3), time format (2 = ms), content type, descriptor, then (text, time) pairs.
function parseSylt(b) {
  const enc = b[0];
  const format = b[4];
  let p = findTerm(b, 6, enc) + termLen(enc);
  const out = [];
  while (p < b.length) {
    const t = findTerm(b, p, enc);
    const text = decodeText(b.subarray(p, t), enc).replace(/^\n/, '');
    p = t + termLen(enc);
    if (p + 4 > b.length) break;
    const time = u32(b, p);
    p += 4;
    if (format === 2) out.push({ t: time / 1000, text });
  }
  return out;
}

const PIC_TYPES = ['Other', 'Icon', 'Other icon', 'Front cover', 'Back cover', 'Leaflet', 'Media', 'Lead artist', 'Artist', 'Conductor', 'Band', 'Composer', 'Lyricist', 'Location', 'During recording', 'During performance', 'Screen capture', 'Fish', 'Illustration', 'Band logo', 'Publisher logo'];

function parseApicHeader(b, ver) {
  if (b.length < 4) return null;
  const enc = b[0];
  let p = 1;
  let mime;
  if (ver === 2) {
    const fmt = str(b, 1, 4).toUpperCase();
    mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
    p = 4;
  } else {
    const t = findTerm(b, 1, 0);
    mime = latin1.decode(b.subarray(1, t)).toLowerCase() || 'image/jpeg';
    if (!mime.includes('/')) mime = 'image/' + (mime === 'jpg' ? 'jpeg' : mime);
    p = t + 1;
  }
  const type = b[p];
  const t2 = findTerm(b, p + 1, enc);
  const desc = decodeText(b.subarray(p + 1, t2), enc).trim();
  const dataOff = t2 + termLen(enc);
  const dims = imageDims(b.subarray(dataOff));
  return { type, typeName: PIC_TYPES[type] || 'Other', mime, desc, dataOff, ...dims };
}

function imageDims(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b.length >= 24) return { w: u32(b, 16), h: u32(b, 20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: u16(b, p + 5), w: u16(b, p + 7) };
      p += 2 + u16(b, p + 2);
    }
  }
  return {};
}

async function parseId3v1(reader, r) {
  if (!reader.size || reader.size < 128) return;
  const b = await reader.bytes(reader.size - 128, 128);
  if (str(b, 0, 3) !== 'TAG') return;
  const s = (a, e) => trimNul(latin1.decode(b.subarray(a, e)));
  r.tagType = r.tagType || (b[125] === 0 && b[126] ? 'ID3v1.1' : 'ID3v1');
  addTag(r, 'TITLE', s(3, 33), 'ID3v1 title');
  addTag(r, 'ARTIST', s(33, 63), 'ID3v1 artist');
  addTag(r, 'ALBUM', s(63, 93), 'ID3v1 album');
  addTag(r, 'DATE', s(93, 97), 'ID3v1 year');
  if (b[125] === 0 && b[126]) {
    addTag(r, 'COMMENT', s(97, 125), 'ID3v1 comment');
    addTag(r, 'TRACKNUMBER', String(b[126]), 'ID3v1 track');
  } else {
    addTag(r, 'COMMENT', s(97, 127), 'ID3v1 comment');
  }
  if (GENRES[b[127]]) addTag(r, 'GENRE', GENRES[b[127]], 'ID3v1 genre');
}

// ---------------------------------------------------------------- MPEG audio
const BR = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SR = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };
const LAME_PRESETS = { 1000: 'r3mix', 1001: 'standard (≈V2)', 1002: 'extreme (≈V0)', 1003: 'insane (320)', 1004: 'fast standard', 1005: 'fast extreme', 1006: 'medium (≈V4)', 1007: 'fast medium' };

function frameHeader(b, i) {
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const vb = (b[i + 1] >> 3) & 3;
  const lb = (b[i + 1] >> 1) & 3;
  const bri = b[i + 2] >> 4;
  const sri = (b[i + 2] >> 2) & 3;
  if (vb === 1 || lb === 0 || bri === 15 || bri === 0 || sri === 3) return null;
  const version = vb === 3 ? 1 : vb === 2 ? 2 : 2.5;
  const layer = 4 - lb;
  const table = version === 1 ? `1-${layer}` : layer === 1 ? '2-1' : '2-2';
  const bitrate = BR[table][bri];
  const sampleRate = SR[version][sri];
  const padding = (b[i + 2] >> 1) & 1;
  const mode = b[i + 3] >> 6;
  const spf = layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576;
  const frameLen = layer === 1 ? Math.floor(((12 * bitrate * 1000) / sampleRate + padding) * 4)
    : Math.floor((spf / 8) * bitrate * 1000 / sampleRate) + padding;
  return {
    version, layer, bitrate, sampleRate, mode, spf, frameLen,
    crc: !(b[i + 1] & 1), copyright: !!(b[i + 3] & 8), original: !!(b[i + 3] & 4), emphasis: b[i + 3] & 3,
  };
}

async function parseMpeg(reader, start, r) {
  const b = await reader.bytes(start, 16384);
  let i = 0;
  let h = null;
  for (; i < b.length - 4; i++) {
    h = frameHeader(b, i);
    if (h) {
      const n = i + h.frameLen;
      if (n + 4 > b.length || frameHeader(b, n)) break;
    }
    h = null;
  }
  if (!h) return;
  const at = start + i;
  r.audioOffset = at;
  r.container = 'MPEG';
  r.codec = h.layer === 3 ? 'MP3' : `MPEG Layer ${['', 'I', 'II'][h.layer]}`;
  r.format = h.layer === 3 ? 'MP3' : h.layer === 2 ? 'MP2' : 'MP1';
  r.sampleRate = h.sampleRate;
  r.channels = h.mode === 3 ? 1 : 2;
  r.channelMode = ['Stereo', 'Joint stereo', 'Dual channel', 'Mono'][h.mode];
  r.bitrate = h.bitrate;
  r.bitrateMode = 'CBR';
  r.extra.push(['MPEG', `MPEG-${h.version} Layer ${['', 'I', 'II', 'III'][h.layer]}`]);

  const f = b.subarray(i);
  const xOff = h.layer === 3 ? (h.version === 1 ? (h.mode === 3 ? 21 : 36) : (h.mode === 3 ? 13 : 21)) : 36;
  const xTag = str(f, xOff, xOff + 4);
  let frames = 0;
  let bytes = 0;
  if (xTag === 'Xing' || xTag === 'Info') {
    const flags = u32(f, xOff + 4);
    let p = xOff + 8;
    if (flags & 1) { frames = u32(f, p); p += 4; }
    if (flags & 2) { bytes = u32(f, p); p += 4; }
    if (flags & 4) p += 100;
    let quality = -1;
    if (flags & 8) { quality = u32(f, p); p += 4; }
    r.bitrateMode = xTag === 'Xing' ? 'VBR' : 'CBR';
    r.extra.push(['VBR header', xTag]);
    const enc = str(f, p, p + 9).replace(/[^\x20-\x7e]/g, '').trim();
    if (/^(LAME|Lavf|Lavc|GOGO)/.test(enc)) {
      r.encoder = enc;
      readLame(f, p, r, quality);
    }
  } else if (str(f, 36, 40) === 'VBRI') {
    bytes = u32(f, 36 + 10);
    frames = u32(f, 36 + 14);
    r.bitrateMode = 'VBR';
    r.extra.push(['VBR header', 'VBRI (Fraunhofer)']);
  }
  if (frames) {
    r.samples = frames * h.spf;
    r.duration = r.samples / h.sampleRate;
    if (bytes) r.bitrate = Math.round((bytes * 8) / r.duration / 1000);
  } else if (reader.size) {
    r.duration = ((reader.size - at) * 8) / (h.bitrate * 1000);
  }
  r.extra.push(['CRC', h.crc ? 'Yes' : 'No']);
  if (h.emphasis) r.extra.push(['Emphasis', ['None', '50/15 µs', 'Reserved', 'CCITT J.17'][h.emphasis]]);
  r.extra.push(['Flags', [h.copyright && 'Copyright', h.original ? 'Original' : 'Copy'].filter(Boolean).join(', ')]);
}

function readLame(f, p, r, quality) {
  if (!/^LAME/.test(r.encoder)) return;
  const method = f[p + 9] & 0x0f;
  const lowpass = f[p + 10] * 100;
  const abr = f[p + 20];
  const preset = u16(f, p + 26) & 0x07ff;
  const modeName = { 1: 'CBR', 2: 'ABR', 3: 'VBR (rh)', 4: 'VBR (mtrh)', 5: 'VBR (mt)', 6: 'VBR', 8: 'CBR (2-pass)', 9: 'ABR (2-pass)' }[method];
  if (method === 1 || method === 8) r.bitrateMode = 'CBR';
  else if (method === 2 || method === 9) r.bitrateMode = 'ABR';
  else if (method >= 3 && method <= 6) r.bitrateMode = 'VBR';
  let presetText = '';
  if (preset >= 410 && preset <= 500) presetText = `-V${(500 - preset) / 10}`;
  else if (LAME_PRESETS[preset]) presetText = `--preset ${LAME_PRESETS[preset]}`;
  else if (preset >= 8 && preset <= 320) presetText = `--preset ${preset} (ABR)`;
  else if (r.bitrateMode === 'VBR' && quality >= 0 && quality <= 100) presetText = `-V${Math.floor((100 - quality) / 10)}`;
  if (modeName) r.extra.push(['LAME mode', modeName]);
  if (presetText) {
    r.extra.push(['LAME preset', presetText]);
    r.lamePreset = presetText.startsWith('-V') ? presetText.slice(1) : '';
  }
  if (abr && r.bitrateMode === 'ABR') r.extra.push(['ABR target', `${abr} kbps`]);
  if (lowpass) r.extra.push(['Lowpass', `${(lowpass / 1000).toFixed(1)} kHz`]);
  const delay = (f[p + 21] << 4) | (f[p + 22] >> 4);
  const padding = ((f[p + 22] & 0x0f) << 8) | f[p + 23];
  r.extra.push(['Encoder delay / padding', `${delay} / ${padding} samples`]);
}

// ---------------------------------------------------------------- FLAC
async function parseFlac(reader, start) {
  const r = newResult('FLAC');
  r.container = 'FLAC';
  r.codec = 'FLAC';
  r.lossless = true;
  r.bitrateMode = 'Lossless';
  let p = start + 4;
  for (let n = 0; n < 64; n++) {
    const h = await reader.bytes(p, 4);
    if (h.length < 4) break;
    const last = !!(h[0] & 0x80);
    const type = h[0] & 0x7f;
    const len = u24(h, 1);
    const body = p + 4;
    if (type === 0) {
      const b = await reader.bytes(body, 34);
      const minBlock = u16(b, 0);
      const maxBlock = u16(b, 2);
      const minFrame = u24(b, 4);
      const maxFrame = u24(b, 7);
      r.sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      r.channels = ((b[12] >> 1) & 7) + 1;
      r.bitDepth = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
      r.samples = (b[13] & 0x0f) * 4294967296 + u32(b, 14);
      const md5 = hex(b.subarray(18, 34));
      r.extra.push(['Block size', minBlock === maxBlock ? `${minBlock} samples (fixed)` : `${minBlock}–${maxBlock} samples`]);
      if (maxFrame) r.extra.push(['Frame size', `${minFrame}–${maxFrame} bytes`]);
      r.extra.push(['Audio MD5', /^0+$/.test(md5) ? 'Not set' : md5]);
    } else if (type === 4) {
      if (len < 2 * 1024 * 1024) {
        const b = await reader.bytes(body, len);
        parseVorbisComment(r, b);
        r.tagType = 'Vorbis comment';
      }
    } else if (type === 6) {
      const b = await reader.bytes(body, Math.min(len, 1024));
      const pic = parseFlacPicture(b);
      if (pic && !(pic.w && pic.h)) {
        // Some taggers leave width/height empty; read them from the image header.
        Object.assign(pic, imageDims(await reader.bytes(body + pic.dataOff, Math.min(pic.dataLen, 64 * 1024))));
      }
      if (pic) r.pictures.push({ ...pic, off: body + pic.dataOff, len: pic.dataLen });
    } else if (type === 3) {
      r.extra.push(['Seek table', `${Math.floor(len / 18)} points`]);
    } else if (type === 5) {
      r.extra.push(['CUE sheet', 'Embedded']);
    } else if (type === 2) {
      const b = await reader.bytes(body, 4);
      r.raw.push(['APPLICATION', str(b, 0, 4)]);
    }
    p = body + len;
    if (last) break;
  }
  r.audioOffset = p;
  return r;
}

function parseFlacPicture(b) {
  if (b.length < 32) return null;
  const type = u32(b, 0);
  const mimeLen = u32(b, 4);
  const mime = str(b, 8, 8 + mimeLen) || 'image/jpeg';
  let p = 8 + mimeLen;
  const descLen = u32(b, p);
  const desc = utf8.decode(b.subarray(p + 4, p + 4 + descLen));
  p += 4 + descLen;
  const w = u32(b, p);
  const h = u32(b, p + 4);
  const depth = u32(b, p + 8);
  const dataLen = u32(b, p + 16);
  return { type, typeName: PIC_TYPES[type] || 'Other', mime, desc, w, h, depth, dataOff: p + 20, dataLen };
}

// ---------------------------------------------------------------- OGG
async function readOggPackets(reader, want) {
  const packets = [];
  let cur = [];
  let p = 0;
  for (let pages = 0; pages < 64 && packets.length < want; pages++) {
    const h = await reader.bytes(p, 27);
    if (str(h, 0, 4) !== 'OggS') break;
    const segs = h[26];
    const table = await reader.bytes(p + 27, segs);
    let body = p + 27 + segs;
    let total = 0;
    for (const s of table) total += s;
    const data = await reader.bytes(body, total);
    let q = 0;
    for (const s of table) {
      cur.push(data.subarray(q, q + s));
      q += s;
      if (s < 255) {
        const size = cur.reduce((a, c) => a + c.length, 0);
        const pk = new Uint8Array(size);
        let w = 0;
        for (const c of cur) { pk.set(c, w); w += c.length; }
        packets.push(pk);
        cur = [];
        if (packets.length >= want) break;
      }
    }
    p = body + total;
    if (cur.reduce((a, c) => a + c.length, 0) > 2 * 1024 * 1024) break;
  }
  return { packets, end: p };
}

async function parseOgg(reader) {
  const r = newResult('OGG');
  r.container = 'Ogg';
  const { packets } = await readOggPackets(reader, 2);
  const [idp, cp] = packets;
  let preSkip = 0;
  if (idp && str(idp, 1, 7) === 'vorbis') {
    r.format = 'OGG';
    r.codec = 'Vorbis';
    r.channels = idp[11];
    r.sampleRate = u32le(idp, 12);
    const nominal = u32le(idp, 20);
    if (nominal && nominal < 0x7fffffff) r.extra.push(['Nominal bitrate', `${Math.round(nominal / 1000)} kbps`]);
    r.bitrateMode = 'VBR';
    if (cp && str(cp, 1, 7) === 'vorbis') parseVorbisComment(r, cp, 7);
  } else if (idp && str(idp, 0, 8) === 'OpusHead') {
    r.format = 'OPUS';
    r.codec = 'Opus';
    r.channels = idp[9];
    preSkip = u16le(idp, 10);
    r.sampleRate = 48000;
    const inputRate = u32le(idp, 12);
    if (inputRate) r.extra.push(['Original sample rate', `${inputRate} Hz`]);
    const gain = (idp[16] | (idp[17] << 8)) << 16 >> 16;
    if (gain) r.extra.push(['Output gain', `${(gain / 256).toFixed(2)} dB`]);
    r.extra.push(['Pre-skip', `${preSkip} samples`]);
    r.bitrateMode = 'VBR';
    if (cp && str(cp, 0, 8) === 'OpusTags') parseVorbisComment(r, cp, 8);
  } else if (idp && str(idp, 1, 5) === 'FLAC') {
    r.format = 'FLAC';
    r.codec = 'FLAC';
    r.lossless = true;
    r.bitrateMode = 'Lossless';
    const si = idp.subarray(13 + 4);
    r.sampleRate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
    r.channels = ((si[12] >> 1) & 7) + 1;
    r.bitDepth = (((si[12] & 1) << 4) | (si[13] >> 4)) + 1;
    if (cp) parseVorbisComment(r, cp, 4);
  }
  r.tagType = 'Vorbis comment';
  // Duration: granule position of the last page
  if (reader.size && r.sampleRate) {
    const tailLen = Math.min(reader.size, 65536);
    const tail = await reader.bytes(reader.size - tailLen, tailLen);
    for (let i = tail.length - 27; i >= 0; i--) {
      if (tail[i] === 0x4f && str(tail, i, i + 4) === 'OggS') {
        const g = u64le(tail, i + 6);
        if (g > 0) r.duration = (g - preSkip) / r.sampleRate;
        break;
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------- MP4
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'ilst', 'edts', 'dinf']);

async function atomAt(reader, p) {
  const h = await reader.bytes(p, 16);
  if (h.length < 8) return null;
  let size = u32(h, 0);
  const type = str(h, 4, 8);
  let hdr = 8;
  if (size === 1) { size = u64(h, 8); hdr = 16; }
  else if (size === 0) size = reader.size - p;
  if (size < hdr) return null;
  return { type, start: p, size, hdr, body: p + hdr, end: p + size };
}

async function parseMp4(reader) {
  const r = newResult('M4A');
  r.container = 'MP4';
  const ftyp = await atomAt(reader, 0);
  const fb = await reader.bytes(8, 8);
  r.extra.push(['Brand', str(fb, 0, 4).trim()]);
  let p = 0;
  let moov = null;
  for (let n = 0; n < 32 && p < reader.size; n++) {
    const a = await atomAt(reader, p);
    if (!a) break;
    if (a.type === 'moov') { moov = a; break; }
    if (a.type === 'mdat') r.audioOffset = a.body;
    p = a.end;
  }
  void ftyp;
  if (!moov) return r;
  let timescale = 0;
  let duration = 0;

  async function walk(start, end, depth) {
    let q = start;
    while (q + 8 <= end) {
      const a = await atomAt(reader, q);
      if (!a || a.end > end + 8) break;
      if (a.type === 'mvhd') {
        const b = await reader.bytes(a.body, 32);
        if (b[0] === 1) { timescale = u32(b, 20); duration = u64(b, 24); }
        else { timescale = u32(b, 12); duration = u32(b, 16); }
      } else if (a.type === 'hdlr' && depth > 1) {
        // skip
      } else if (a.type === 'stsd') {
        const b = await reader.bytes(a.body, Math.min(a.size, 512));
        parseStsd(b, r);
      } else if (a.type === 'meta') {
        await walk(a.body + 4, a.end, depth + 1);
      } else if (CONTAINERS.has(a.type)) {
        if (a.type === 'ilst') await parseIlst(reader, a, r);
        else await walk(a.body, a.end, depth + 1);
      }
      q = a.end;
    }
  }
  await walk(moov.body, moov.end, 0);
  if (timescale) r.duration = duration / timescale;
  r.tagType = Object.keys(r.tags).length ? 'iTunes (MP4)' : '';
  if (r.codec === 'ALAC') r.format = 'ALAC';
  else if (r.codec.startsWith('AAC') || r.codec.startsWith('HE-AAC')) r.format = 'AAC';
  return r;
}

function parseStsd(b, r) {
  // b: stsd body -> ver/flags(4) count(4) entry...
  const e = 8;
  const fmt = str(b, e + 4, e + 8);
  r.channels = u16(b, e + 24);
  r.bitDepth = u16(b, e + 26);
  r.sampleRate = u32(b, e + 32) >>> 16;
  let q = e + 36;
  const entryEnd = e + u32(b, e);
  if (fmt === 'alac') {
    r.codec = 'ALAC';
    r.lossless = true;
    r.bitrateMode = 'Lossless';
    while (q + 8 <= Math.min(entryEnd, b.length)) {
      const size = u32(b, q);
      if (str(b, q + 4, q + 8) === 'alac' && q + 36 <= b.length) {
        const c = q + 12;
        r.bitDepth = b[c + 5];
        r.channels = b[c + 9];
        r.sampleRate = u32(b, c + 20);
        break;
      }
      if (size < 8) break;
      q += size;
    }
  } else if (fmt === 'mp4a') {
    r.codec = 'AAC';
    r.bitDepth = 0;
    while (q + 8 <= Math.min(entryEnd, b.length)) {
      const size = u32(b, q);
      if (str(b, q + 4, q + 8) === 'esds') {
        parseEsds(b.subarray(q + 12, q + size), r);
        break;
      }
      if (size < 8) break;
      q += size;
    }
  } else if (fmt === 'fLaC') {
    r.codec = 'FLAC';
    r.lossless = true;
    r.bitrateMode = 'Lossless';
  } else if (fmt === 'Opus') {
    r.codec = 'Opus';
  } else if (fmt === 'ac-3' || fmt === 'ec-3') {
    r.codec = fmt === 'ac-3' ? 'AC-3' : 'E-AC-3';
  } else {
    r.codec = fmt;
  }
  r.extra.push(['Sample entry', fmt]);
}

function parseEsds(b, r) {
  let p = 0;
  const readLen = () => {
    let len = 0;
    for (let i = 0; i < 4; i++) {
      const x = b[p++];
      len = (len << 7) | (x & 0x7f);
      if (!(x & 0x80)) break;
    }
    return len;
  };
  while (p < b.length) {
    const tag = b[p++];
    const len = readLen();
    if (tag === 0x03) { p += 3; continue; }
    if (tag === 0x04) {
      const oti = b[p];
      const maxBr = u32(b, p + 5);
      const avgBr = u32(b, p + 9);
      if (oti === 0x6b || oti === 0x69) r.codec = 'MP3';
      if (avgBr) r.extra.push(['Avg bitrate (esds)', `${Math.round(avgBr / 1000)} kbps`]);
      if (maxBr) r.extra.push(['Max bitrate (esds)', `${Math.round(maxBr / 1000)} kbps`]);
      r.bitrateMode = avgBr && maxBr && Math.abs(avgBr - maxBr) < 1000 ? 'CBR' : 'VBR';
      p += 13;
      continue;
    }
    if (tag === 0x05) {
      const aot = b[p] >> 3;
      const name = { 1: 'AAC Main', 2: 'AAC-LC', 3: 'AAC SSR', 4: 'AAC LTP', 5: 'HE-AAC (SBR)', 29: 'HE-AAC v2 (PS)', 23: 'AAC-LD', 39: 'AAC-ELD' }[aot];
      if (name && r.codec !== 'MP3') r.codec = name;
      r.extra.push(['Audio object type', `${aot}${name ? ' · ' + name : ''}`]);
      break;
    }
    p += len;
  }
}

async function parseIlst(reader, ilst, r) {
  let q = ilst.body;
  while (q + 8 <= ilst.end) {
    const item = await atomAt(reader, q);
    if (!item) break;
    const key = item.type;
    if (key === 'covr') {
      let d = item.body;
      while (d + 16 <= item.end) {
        const da = await atomAt(reader, d);
        if (!da) break;
        if (da.type === 'data') {
          const hb = await reader.bytes(da.body, 8 + 32);
          const t = u32(hb, 0) & 0xffffff;
          const mime = t === 14 ? 'image/png' : 'image/jpeg';
          r.pictures.push({ type: 3, typeName: 'Front cover', mime, ...imageDims(hb.subarray(8)), off: da.body + 8, len: da.size - da.hdr - 8 });
        }
        d = da.end;
      }
    } else if (item.size < 512 * 1024) {
      const b = await reader.bytes(item.body, item.size - item.hdr);
      readIlstItem(r, key, b);
    }
    q = item.end;
  }
}

function readIlstItem(r, key, b) {
  let p = 0;
  let mean = '';
  let name = '';
  while (p + 8 <= b.length) {
    const size = u32(b, p);
    const type = str(b, p + 4, p + 8);
    if (size < 8) break;
    const body = b.subarray(p + 8, p + size);
    if (type === 'mean') mean = utf8.decode(body.subarray(4));
    else if (type === 'name') name = utf8.decode(body.subarray(4));
    else if (type === 'data') {
      const dt = u32(body, 0) & 0xffffff;
      const v = body.subarray(8);
      if (key === 'trkn' || key === 'disk') {
        const n = u16(v, 2);
        const t = u16(v, 4);
        const k = key === 'trkn' ? 'TRACKNUMBER' : 'DISCNUMBER';
        if (n) addTag(r, k, t ? `${n}/${t}` : String(n), key);
      } else if (key === 'tmpo') {
        addTag(r, 'BPM', String(u16(v, 0)), key);
      } else if (key === 'cpil') {
        if (v[0]) addTag(r, 'COMPILATION', '1', key);
      } else if (key === 'gnre') {
        const g = GENRES[u16(v, 0) - 1];
        if (g) addTag(r, 'GENRE', g, key);
      } else if (key === '----') {
        const val = utf8.decode(v);
        if (name === 'iTunNORM' || name === 'iTunSMPB' || name === 'iTunes_CDDB_IDs') r.raw.push([name, val.trim()]);
        else addTag(r, name, val, `----:${mean.replace('com.apple.iTunes', 'iTunes')}:${name}`);
      } else if (dt === 1 || dt === 0) {
        const val = utf8.decode(v);
        if (MP4_MAP[key]) addTag(r, MP4_MAP[key], val, key);
        else r.raw.push([key, val]);
      } else if (dt === 21 || dt === 22) {
        r.raw.push([key, String(v.length === 1 ? v[0] : v.length === 2 ? u16(v, 0) : u32(v, 0))]);
      }
    }
    p += size;
  }
}

// ---------------------------------------------------------------- WAV
async function parseWav(reader) {
  const r = newResult('WAV');
  r.container = 'RIFF WAVE';
  r.lossless = true;
  r.bitrateMode = 'Lossless';
  r.codec = 'PCM';
  let p = 12;
  let byteRate = 0;
  let dataSize = 0;
  for (let n = 0; n < 64 && p + 8 <= reader.size; n++) {
    const h = await reader.bytes(p, 8);
    if (h.length < 8) break;
    const id = str(h, 0, 4);
    const size = u32le(h, 4);
    const body = p + 8;
    if (id === 'fmt ') {
      const b = await reader.bytes(body, Math.min(size, 40));
      let fmt = u16le(b, 0);
      r.channels = u16le(b, 2);
      r.sampleRate = u32le(b, 4);
      byteRate = u32le(b, 8);
      r.bitDepth = u16le(b, 14);
      if (fmt === 0xfffe && b.length >= 26) fmt = u16le(b, 24);
      r.codec = { 1: 'PCM', 3: 'PCM (float)', 6: 'A-law', 7: 'µ-law', 0x55: 'MP3' }[fmt] || `WAV format 0x${fmt.toString(16)}`;
      if (fmt !== 1 && fmt !== 3) { r.lossless = false; r.bitrateMode = ''; }
    } else if (id === 'data') {
      dataSize = size;
      r.audioOffset = body;
    } else if (id === 'LIST') {
      const b = await reader.bytes(body, Math.min(size, 256 * 1024));
      if (str(b, 0, 4) === 'INFO') {
        let q = 4;
        const map = { INAM: 'TITLE', IART: 'ARTIST', IPRD: 'ALBUM', ICRD: 'DATE', IGNR: 'GENRE', ICMT: 'COMMENT', ITRK: 'TRACKNUMBER', IPRT: 'TRACKNUMBER', ISFT: 'ENCODER', ICOP: 'COPYRIGHT', IENG: 'ENGINEER', ICMS: 'COMMISSIONED', ISRC: 'SOURCE' };
        while (q + 8 <= b.length) {
          const sid = str(b, q, q + 4);
          const ss = u32le(b, q + 4);
          const val = trimNul(utf8.decode(b.subarray(q + 8, q + 8 + ss)));
          if (map[sid]) addTag(r, map[sid], val, 'INFO ' + sid);
          else r.raw.push(['INFO ' + sid, val]);
          q += 8 + ss + (ss & 1);
        }
        r.tagType = 'RIFF INFO';
      }
    } else if (id === 'id3 ' || id === 'ID3 ') {
      const t = newResult('WAV');
      await parseId3v2(reader, body, t);
      mergeTags(r, t);
    } else if (id === 'bext') {
      r.extra.push(['Broadcast WAV', 'bext chunk']);
    }
    p = body + size + (size & 1);
  }
  if (byteRate && dataSize) r.duration = dataSize / byteRate;
  if (r.channels && r.bitDepth && dataSize) r.samples = Math.round(dataSize / (r.channels * (r.bitDepth / 8)));
  return r;
}

// ---------------------------------------------------------------- helpers for UI
export function first(meta, key) {
  return meta?.tags?.[key]?.[0] || '';
}

export function pickPicture(meta) {
  if (!meta?.pictures?.length) return null;
  return meta.pictures.find((p) => p.type === 3) || meta.pictures[0];
}

/** "FLAC · 2845 kbps · 96.0 kHz · 24-bit · Stereo" */
export function techLine(meta) {
  if (!meta) return '';
  const parts = [meta.codec || meta.format];
  if (meta.bitrate) parts.push(`${meta.bitrate} kbps${meta.lamePreset ? ' ' + meta.lamePreset : meta.bitrateMode === 'VBR' ? ' VBR' : ''}`);
  if (meta.sampleRate) parts.push(`${(meta.sampleRate / 1000).toFixed(1)} kHz`);
  if (meta.bitDepth) parts.push(`${meta.bitDepth}-bit`);
  if (meta.channelMode) parts.push(meta.channelMode);
  return parts.join(' · ');
}

/** Short badge: "24/96", "16/44.1", "320", "V0" */
export function qualityTag(meta) {
  if (!meta) return '';
  if (meta.lossless && meta.bitDepth && meta.sampleRate) {
    const k = meta.sampleRate / 1000;
    return `${meta.bitDepth}/${Number.isInteger(k) ? k : k.toFixed(1)}`;
  }
  if (meta.lamePreset) return meta.lamePreset;
  return meta.bitrate ? String(meta.bitrate) : '';
}

export function qualityBadge(meta) {
  if (!meta) return '';
  if (meta.hiRes) return 'Hi-Res Lossless';
  if (meta.lossless) return 'Lossless';
  return `${meta.codec || meta.format}${meta.bitrate ? ' ' + meta.bitrate + ' kbps' : ''}`;
}
