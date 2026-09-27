// Audio analysis: spectrogram, frequency cutoff ("is this lossless really
// lossless?"), peak, loudness, dynamic range and clipping. Runs entirely in
// the browser on the decoded audio.

const FFT = 4096;
const COLS = 520;
const ROWS = 260;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// Dark blue → purple → orange → yellow, like classic spectrogram tools.
function color(v) {
  const stops = [[0, [4, 4, 18]], [0.3, [60, 15, 110]], [0.55, [180, 40, 110]], [0.78, [250, 130, 40]], [1, [255, 245, 170]]];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const k = (v - p0) / (p1 - p0);
      return c0.map((c, j) => Math.round(c + (c1[j] - c) * k));
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * blob: the whole audio file. sampleRate: the file's rate (decoded at that rate).
 * Resolves { image (data URL), cutoffHz, nyquist, peakDb, rmsDb, drDb, clipped, verdict, verdictLevel }.
 */
export async function analyzeAudio(blob, { sampleRate = 44100, lossless = false } = {}) {
  const rate = Math.min(Math.max(sampleRate || 44100, 8000), 384000);
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, rate);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const chans = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const len = audio.length;
  const nyquist = audio.sampleRate / 2;

  // Peak, RMS, clipping, and short-term loudness for a simple dynamic range.
  let peak = 0;
  let sumSq = 0;
  let clipped = 0;
  const block = Math.round(audio.sampleRate * 3);
  const blockRms = [];
  for (let start = 0; start < len; start += block) {
    let bs = 0;
    const end = Math.min(len, start + block);
    for (const ch of chans) {
      for (let i = start; i < end; i++) {
        const s = ch[i];
        const a = s < 0 ? -s : s;
        if (a > peak) peak = a;
        if (a >= 0.9999) clipped++;
        bs += s * s;
      }
    }
    sumSq += bs;
    blockRms.push(Math.sqrt(bs / ((end - start) * chans.length || 1)));
  }
  const rms = Math.sqrt(sumSq / (len * chans.length || 1));
  const dbfs = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const loud = blockRms.filter((x) => x > 0).sort((a, b) => b - a);
  const top = loud.slice(0, Math.max(1, Math.round(loud.length * 0.2)));
  const topRms = Math.sqrt(top.reduce((s, x) => s + x * x, 0) / top.length);
  const drDb = dbfs(peak) - dbfs(topRms); // similar in spirit to the DR meter

  // Spectrogram over COLS evenly spaced windows.
  const half = FFT / 2;
  const win = new Float32Array(FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const avg = new Float64Array(half);
  const cols = [];
  const re = new Float32Array(FFT);
  const im = new Float32Array(FFT);
  const step = Math.max(1, Math.floor((len - FFT) / COLS));
  for (let c = 0; c < COLS; c++) {
    const at = Math.min(len - FFT, c * step);
    if (at < 0) break;
    for (let i = 0; i < FFT; i++) {
      let s = 0;
      for (const ch of chans) s += ch[at + i];
      re[i] = (s / chans.length) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const col = new Float32Array(half);
    for (let k = 0; k < half; k++) {
      const mag = Math.hypot(re[k], im[k]) / (FFT / 4);
      const db = mag > 1e-12 ? 20 * Math.log10(mag) : -240;
      col[k] = db;
      avg[k] += Math.pow(10, db / 10);
    }
    cols.push(col);
  }
  const avgDb = Array.from(avg, (p) => 10 * Math.log10(p / (cols.length || 1) + 1e-30));

  // Cutoff: the highest frequency that still carries real content.
  const smooth = avgDb.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - 6); j <= Math.min(half - 1, i + 6); j++) { s += avgDb[j]; n++; }
    return s / n;
  });
  const maxDb = Math.max(...smooth.slice(2));
  let cutBin = 0;
  for (let k = half - 1; k > 0; k--) {
    if (smooth[k] > maxDb - 70) { cutBin = k; break; }
  }
  const cutoffHz = (cutBin / half) * nyquist;

  // Draw.
  const canvas = document.createElement('canvas');
  canvas.width = cols.length;
  canvas.height = ROWS;
  const g = canvas.getContext('2d');
  const img = g.createImageData(cols.length, ROWS);
  for (let x = 0; x < cols.length; x++) {
    const col = cols[x];
    for (let y = 0; y < ROWS; y++) {
      const k0 = Math.floor(((ROWS - 1 - y) / ROWS) * half);
      const k1 = Math.max(k0 + 1, Math.floor(((ROWS - y) / ROWS) * half));
      let m = -240;
      for (let k = k0; k < k1; k++) if (col[k] > m) m = col[k];
      const v = Math.max(0, Math.min(1, (m + 120) / 120));
      const [r, gg, b] = color(v);
      const o = (y * cols.length + x) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Cutoff line.
  const cy = Math.round((1 - cutoffHz / nyquist) * ROWS);
  g.strokeStyle = 'rgba(255,255,255,.55)';
  g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(0, cy + 0.5); g.lineTo(cols.length, cy + 0.5); g.stroke();

  // Verdict.
  const kHz = (cutoffHz / 1000).toFixed(1);
  let verdict;
  let level = 'good';
  if (lossless && audio.sampleRate > 48000 && cutoffHz < 23000) {
    verdict = `No sound above ${kHz} kHz, even though the file is ${Math.round(audio.sampleRate / 1000)} kHz. It was probably converted up from CD quality (44.1/48 kHz), so it isn't true Hi-Res.`;
    level = 'warn';
  } else if (lossless && cutoffHz < 16500) {
    verdict = `Sound stops at ${kHz} kHz. That's typical of a 128 kbps MP3, so this lossless file was likely made from a lossy source.`;
    level = 'bad';
  } else if (lossless && cutoffHz < 19000) {
    verdict = `Sound stops at ${kHz} kHz, typical of a ~192 kbps lossy file. This may not be truly lossless.`;
    level = 'bad';
  } else if (lossless && cutoffHz < 20500) {
    verdict = `Sound stops at ${kHz} kHz. That can be a 256–320 kbps lossy source, or a quiet or old recording. Worth a closer look.`;
    level = 'warn';
  } else if (lossless) {
    verdict = `Full frequency range up to ${kHz} kHz. This looks truly lossless.`;
  } else {
    verdict = `Lossy file with sound up to ${kHz} kHz (normal for its format).`;
    level = 'info';
  }
  if (clipped > 50) verdict += ` ${clipped.toLocaleString('en-US')} samples hit full scale (clipping).`;

  return {
    image: canvas.toDataURL('image/png'),
    cutoffHz,
    nyquist,
    peakDb: dbfs(peak),
    rmsDb: dbfs(rms),
    drDb,
    clipped,
    verdict,
    level,
  };
}
