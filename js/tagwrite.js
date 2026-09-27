// Writes tags (and a front cover) into FLAC and MP3 files.
// Only the metadata part of the file is rebuilt; the audio bytes are copied
// unchanged. Callers must verify the result (see verifyWritten) before saving.

const enc = new TextEncoder();
const latin1 = new TextDecoder('latin1');

export const canWriteTags = (meta) => !!meta && !meta.error && (meta.format === 'FLAC' && meta.container === 'FLAC' || meta.codec === 'MP3');

/**
 * fields: { TITLE, ARTIST, ALBUMARTIST, ALBUM, DATE, GENRE, TRACKNUMBER, DISCNUMBER }
 * (a value of '' removes the tag; a missing key leaves it as it is)
 * cover: { bytes: Uint8Array, mime } or null to keep the current cover.
 */
export function writeTags(bytes, meta, fields, cover) {
  if (meta.format === 'FLAC') return writeFlac(bytes, fields, cover);
  if (meta.codec === 'MP3') return writeMp3(bytes, fields, cover);
  throw new Error('Writing tags into this format is not supported yet.');
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const u32be = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u32le = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const u24be = (n) => new Uint8Array([(n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const rd32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const rd32le = (b, i) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0);
const rd24be = (b, i) => (b[i] << 16) + (b[i + 1] << 8) + b[i + 2];

// ---------------------------------------------------------------- FLAC
const FLAC_ALIASES = {
  TRACKNUMBER: ['TRACKNUMBER'],
  DISCNUMBER: ['DISCNUMBER'],
  ALBUMARTIST: ['ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM_ARTIST'],
  DATE: ['DATE', 'YEAR'],
};

function writeFlac(bytes, fields, cover) {
  let start = 0;
  if (latin1.decode(bytes.subarray(0, 3)) === 'ID3') {
    // A stray ID3 tag before fLaC: drop it.
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    start = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  if (latin1.decode(bytes.subarray(start, start + 4)) !== 'fLaC') throw new Error('Not a FLAC file.');
  let p = start + 4;
  const blocks = [];
  for (;;) {
    const last = !!(bytes[p] & 0x80);
    const type = bytes[p] & 0x7f;
    const len = rd24be(bytes, p + 1);
    blocks.push({ type, data: bytes.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
    if (last) break;
    if (p >= bytes.length) throw new Error('Damaged FLAC header.');
  }
  const audio = bytes.subarray(p);
  if (blocks[0]?.type !== 0) throw new Error('FLAC STREAMINFO missing.');

  // Vorbis comments: keep everything, replace the fields we're changing.
  const vcBlock = blocks.find((b) => b.type === 4);
  let vendor = 'N4cuply';
  let comments = [];
  if (vcBlock) {
    const d = vcBlock.data;
    const vlen = rd32le(d, 0);
    vendor = new TextDecoder().decode(d.subarray(4, 4 + vlen));
    let q = 4 + vlen;
    const count = rd32le(d, q);
    q += 4;
    for (let i = 0; i < count && q + 4 <= d.length; i++) {
      const l = rd32le(d, q);
      comments.push(new TextDecoder().decode(d.subarray(q + 4, q + 4 + l)));
      q += 4 + l;
    }
  }
  for (const [key, value] of Object.entries(fields)) {
    const names = new Set((FLAC_ALIASES[key] || [key]).map((k) => k.toUpperCase()));
    if (key === 'TRACKNUMBER') { names.add('TRACKTOTAL'); names.add('TOTALTRACKS'); }
    if (key === 'DISCNUMBER') { names.add('DISCTOTAL'); names.add('TOTALDISCS'); }
    comments = comments.filter((c) => !names.has(c.slice(0, c.indexOf('=')).toUpperCase()));
    if (value === '' || value == null) continue;
    const [n, total] = String(value).split('/');
    if ((key === 'TRACKNUMBER' || key === 'DISCNUMBER') && total) {
      comments.push(`${key}=${n}`);
      comments.push(`${key === 'TRACKNUMBER' ? 'TRACKTOTAL' : 'DISCTOTAL'}=${total}`);
    } else {
      comments.push(`${key}=${value}`);
    }
  }
  const vcParts = [u32le(enc.encode(vendor).length), enc.encode(vendor), u32le(comments.length)];
  for (const c of comments) { const b = enc.encode(c); vcParts.push(u32le(b.length), b); }
  const newVc = { type: 4, data: concat(vcParts) };

  let out = blocks.filter((b) => b.type !== 4 && b.type !== 1); // drop old comments and padding
  if (cover) {
    out = out.filter((b) => !(b.type === 6 && rd32be(b.data, 0) === 3));
    const mime = enc.encode(cover.mime || 'image/jpeg');
    const pic = concat([u32be(3), u32be(mime.length), mime, u32be(0), u32be(0), u32be(0), u32be(0), u32be(0), u32be(cover.bytes.length), cover.bytes]);
    out.push({ type: 6, data: pic });
  }
  out.splice(1, 0, newVc); // right after STREAMINFO
  out.push({ type: 1, data: new Uint8Array(4096) }); // room for future edits
  for (const b of out) if (b.data.length >= 1 << 24) throw new Error('Cover image is too large for FLAC.');

  const parts = [enc.encode('fLaC')];
  out.forEach((b, i) => {
    parts.push(new Uint8Array([(i === out.length - 1 ? 0x80 : 0) | b.type]), u24be(b.data.length), b.data);
  });
  parts.push(audio);
  return concat(parts);
}

// ---------------------------------------------------------------- MP3 (ID3v2)
const ID3_IDS = {
  TITLE: 'TIT2', ARTIST: 'TPE1', ALBUMARTIST: 'TPE2', ALBUM: 'TALB', GENRE: 'TCON', TRACKNUMBER: 'TRCK', DISCNUMBER: 'TPOS',
};

const synchsafe = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
const toSynchsafe = (n) => new Uint8Array([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);

function deUnsync(b) {
  const out = new Uint8Array(b.length);
  let w = 0;
  for (let i = 0; i < b.length; i++) {
    out[w++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, w);
}

function textFrameData(value, ver) {
  if (ver === 4) return concat([new Uint8Array([3]), enc.encode(value)]);
  // v2.3: UTF-16 with BOM
  const s = String(value);
  const out = new Uint8Array(3 + s.length * 2);
  out[0] = 1; out[1] = 0xff; out[2] = 0xfe;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[3 + i * 2] = c & 255; out[4 + i * 2] = c >> 8; }
  return out;
}

function frame(id, data, ver) {
  return concat([enc.encode(id), ver === 4 ? toSynchsafe(data.length) : u32be(data.length), new Uint8Array([0, 0]), data]);
}

function writeMp3(bytes, fields, cover) {
  let ver = 3;
  let audioStart = 0;
  const kept = [];
  if (latin1.decode(bytes.subarray(0, 3)) === 'ID3') {
    const v = bytes[3];
    const flags = bytes[5];
    const size = synchsafe(bytes, 6);
    audioStart = 10 + size + (flags & 0x10 ? 10 : 0);
    if (v === 3 || v === 4) {
      ver = v;
      let body = bytes.subarray(10, 10 + size);
      if (v === 3 && flags & 0x80) body = deUnsync(body);
      let p = 0;
      if (flags & 0x40) p += v === 3 ? 4 + rd32be(body, 0) : synchsafe(body, 0);
      const replace = new Set(Object.keys(fields).map((k) => (k === 'DATE' ? (ver === 4 ? 'TDRC' : 'TYER') : ID3_IDS[k])).filter(Boolean));
      if ('DATE' in fields) { replace.add('TYER'); replace.add('TDAT'); replace.add('TDRC'); }
      if (cover) replace.add('APIC');
      while (p + 10 <= body.length) {
        const id = latin1.decode(body.subarray(p, p + 4));
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fsize = v === 4 ? synchsafe(body, p + 4) : rd32be(body, p + 4);
        const whole = body.subarray(p, p + 10 + fsize);
        p += 10 + fsize;
        if (id === 'APIC' && cover) {
          // Only replace the front cover (picture type 3); keep other pictures.
          const d = whole.subarray(10);
          const mimeEnd = d.indexOf(0, 1);
          if (d[mimeEnd + 1] === 3) continue;
          kept.push(whole);
          continue;
        }
        if (replace.has(id)) continue;
        kept.push(whole);
      }
    }
    // ID3v2.2 tags are dropped and rewritten as v2.3.
  }

  const frames = [...kept];
  for (const [key, value] of Object.entries(fields)) {
    if (value === '' || value == null) continue;
    const id = key === 'DATE' ? (ver === 4 ? 'TDRC' : 'TYER') : ID3_IDS[key];
    if (!id) continue;
    frames.push(frame(id, textFrameData(ver === 3 && key === 'DATE' ? String(value).slice(0, 4) : value, ver), ver));
  }
  if (cover) {
    const data = concat([new Uint8Array([0]), enc.encode(cover.mime || 'image/jpeg'), new Uint8Array([0, 3, 0]), cover.bytes]);
    frames.push(frame('APIC', data, ver));
  }
  const body = concat([...frames, new Uint8Array(2048)]);
  const header = concat([enc.encode('ID3'), new Uint8Array([ver, 0, 0]), toSynchsafe(body.length)]);
  return concat([header, body, bytes.subarray(audioStart)]);
}
