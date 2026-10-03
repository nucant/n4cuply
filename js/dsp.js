// Sound effects (Web Audio): preamp / volume boost, 10-band equalizer, bass and
// treble, balance, mono and a limiter. The player routes both decks through
// one chain built here; settings change it live, no restart.
//
//   decks -> input -> preamp -> 10 EQ bands -> bass -> treble -> balance -> mono? -> limiter -> output

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

export const EQ_PRESETS = {
  flat: { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { name: 'Bass boost', gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0] },
  treble: { name: 'Treble boost', gains: [0, 0, 0, 0, 0, 1, 2, 4, 6, 7] },
  vocal: { name: 'Vocal', gains: [-2, -2, -1, 1, 3, 4, 4, 3, 1, 0] },
  rock: { name: 'Rock', gains: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
  pop: { name: 'Pop', gains: [-1, 1, 3, 4, 3, 1, -1, -1, 1, 2] },
  dance: { name: 'Dance', gains: [6, 5, 2, 0, 0, -2, -2, 0, 4, 5] },
  classical: { name: 'Classical', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  jazz: { name: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  bollywood: { name: 'Bollywood', gains: [4, 4, 2, 0, 1, 2, 3, 2, 3, 3] },
  loudness: { name: 'Loudness', gains: [6, 4, 1, 0, -1, 0, 0, 1, 4, 6] },
  night: { name: 'Night', gains: [-3, -2, 0, 1, 2, 2, 1, 0, -2, -4] },
};

export const DSP_DEFAULTS = {
  eqOn: false,
  preset: 'flat',          // a key of EQ_PRESETS, or 'custom'
  gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // dB, -12..12
  preamp: 0,               // dB, -12..12; above 0 is the volume booster
  bass: 0,                 // dB, -12..12 (low shelf at 100 Hz)
  treble: 0,               // dB, -12..12 (high shelf at 8 kHz)
  balance: 0,              // -1 (left) .. 1 (right)
  mono: false,
  limiter: true,           // stops boosts from clipping
};

/** True when any effect changes the sound, so Web Audio is needed. */
export function dspActive(d) {
  if (!d) return false;
  return (d.eqOn && d.gains.some((g) => g !== 0)) || d.preamp !== 0 || d.bass !== 0 || d.treble !== 0 || d.balance !== 0 || d.mono;
}

/** Builds the chain on an AudioContext. Returns { input, output, apply(settings) }. */
export function createChain(ctx) {
  const input = ctx.createGain();
  const preamp = ctx.createGain();
  const bands = EQ_BANDS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    b.Q.value = 1.1;
    return b;
  });
  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 100;
  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 8000;
  const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  // Mono: squeeze to one channel; the speakers get it on both sides.
  const mono = ctx.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  const output = ctx.createGain();

  let last = null; // which optional stages are in the chain now

  function wire(d) {
    const shape = `${d.mono}|${d.limiter}`;
    if (shape === last) return;
    last = shape;
    for (const n of [input, preamp, ...bands, bass, treble, panner, mono, limiter].filter(Boolean)) n.disconnect();
    const chain = [input, preamp, ...bands, bass, treble];
    if (panner) chain.push(panner);
    if (d.mono) chain.push(mono);
    if (d.limiter) chain.push(limiter);
    chain.push(output);
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
  }

  function apply(d) {
    const s = { ...DSP_DEFAULTS, ...d };
    const t = ctx.currentTime;
    // Short ramps so moving a slider doesn't click.
    const set = (param, v) => param.setTargetAtTime(v, t, 0.02);
    set(preamp.gain, 10 ** (s.preamp / 20));
    bands.forEach((b, i) => set(b.gain, s.eqOn ? s.gains[i] || 0 : 0));
    set(bass.gain, s.bass);
    set(treble.gain, s.treble);
    if (panner) set(panner.pan, Math.max(-1, Math.min(1, s.balance)));
    wire(s);
  }

  apply(DSP_DEFAULTS);
  return { input, output, apply };
}
