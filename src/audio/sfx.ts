// Sound effects synthesized with the Web Audio API: no audio files.
//
// Web Audio works like a modular synth: you create "nodes" (sources, filters,
// volume controls) and connect them in a graph that ends at the speakers:
//
//   noise ──▶ lowpass filter ──▶ gain (volume envelope) ──▶ master ──▶ speakers
//
// An "envelope" is how the volume changes over time: a gunshot is a very
// fast attack and a quick decay. We schedule those changes in advance with
// setValueAtTime / exponentialRampToValueAtTime.

let ctx: AudioContext | null = null;
let master: GainNode;
let noiseBuffer: AudioBuffer;

/** Master volume, 0..1. */
export const sfxSettings = { volume: 0.5 };

/**
 * Browsers only allow audio after a user gesture (click/key), so we create
 * the AudioContext lazily, on the first click that locks the pointer.
 */
export function initAudio(): void {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = sfxSettings.volume;
  master.connect(ctx.destination);

  // One second of white noise (random samples), reused by every sound.
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

/** Plays a burst of filtered noise with a volume envelope. */
function noiseBurst(options: {
  out?: AudioNode;
  start?: number;
  duration: number;
  volume: number;
  filter: BiquadFilterType;
  frequency: number;
  frequencyEnd?: number;
  q?: number;
}): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + (options.start ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter;
  filter.frequency.setValueAtTime(options.frequency, t0);
  if (options.frequencyEnd) {
    filter.frequency.exponentialRampToValueAtTime(options.frequencyEnd, t0 + options.duration);
  }
  filter.Q.value = options.q ?? 1;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + options.duration); // fast decay
  src.connect(filter).connect(gain).connect(options.out ?? master);
  // Start at a random point of the noise so repeated sounds aren't identical.
  src.start(t0, Math.random() * 0.5, options.duration);
}

/** A sine "thump" whose pitch drops: the low punch of a shot or a click. */
function thump(options: {
  out?: AudioNode;
  start?: number;
  duration: number;
  volume: number;
  from: number;
  to: number;
}): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + (options.start ?? 0);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(options.from, t0);
  osc.frequency.exponentialRampToValueAtTime(options.to, t0 + options.duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + options.duration);
  osc.connect(gain).connect(options.out ?? master);
  osc.start(t0);
  osc.stop(t0 + options.duration);
}

/** Revolver shot: a sharp crack, a heavy low boom, and a short echo tail. */
export function playShot(): void {
  if (!ctx) return;
  master.gain.value = sfxSettings.volume;
  // Pitch varies a little at every shot: identical sounds feel robotic.
  const v = 0.9 + Math.random() * 0.2;
  noiseBurst({ duration: 0.08, volume: 0.9, filter: 'highpass', frequency: 1800 * v }); // crack
  noiseBurst({ duration: 0.35, volume: 1.0, filter: 'lowpass', frequency: 2500 * v, frequencyEnd: 200 }); // blast
  thump({ duration: 0.25, volume: 0.9, from: 150 * v, to: 40 }); // punch in the chest
  // Echo off the canyon walls: the same blast, quieter and darker, later.
  noiseBurst({ start: 0.18, duration: 0.5, volume: 0.18, filter: 'lowpass', frequency: 900, frequencyEnd: 150 });
}

/** Empty cylinder: the hammer falls on nothing. */
export function playDryFire(): void {
  noiseBurst({ duration: 0.03, volume: 0.5, filter: 'bandpass', frequency: 3500, q: 4 });
  thump({ duration: 0.04, volume: 0.2, from: 900, to: 500 });
}

/** Reload: cylinder opens, rounds go in (a few clicks), cylinder snaps shut. */
export function playReload(duration: number): void {
  noiseBurst({ duration: 0.05, volume: 0.4, filter: 'bandpass', frequency: 2200, q: 3 }); // open
  for (let i = 0; i < 6; i++) {
    const t = 0.15 + (i / 6) * (duration - 0.35);
    noiseBurst({ start: t, duration: 0.025, volume: 0.25, filter: 'bandpass', frequency: 4000, q: 6 });
  }
  noiseBurst({ start: duration - 0.12, duration: 0.06, volume: 0.6, filter: 'bandpass', frequency: 1600, q: 2 }); // snap
  thump({ start: duration - 0.12, duration: 0.05, volume: 0.3, from: 400, to: 200 });
}

/**
 * A metallic "ding": a few sine partials at frequencies that are NOT simple
 * multiples of each other ("inharmonic"), which is what makes metal sound
 * like metal instead of like a musical note. Each one rings and fades.
 */
function ring(base: number, duration: number, volume: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (const [ratio, gainRatio] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.12]]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = base * ratio * (0.98 + Math.random() * 0.04);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * gainRatio, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration / ratio ** 0.3);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration);
  }
}

/** Bullet hits a steel target. */
export function playTargetHit(): void {
  ring(900 + Math.random() * 120, 0.5, 0.35);
  noiseBurst({ duration: 0.03, volume: 0.4, filter: 'highpass', frequency: 3000 });
}

/** Target knocked down: a lower, longer clang and a thud. */
export function playTargetDown(): void {
  ring(520, 1.2, 0.45);
  noiseBurst({ start: 0.25, duration: 0.15, volume: 0.35, filter: 'lowpass', frequency: 600 });
}

// --- Positional sounds (enemies) ----------------------------------------------
/**
 * A sound coming from a place: `volume` 0..1 (from the distance) and `pan`
 * -1 (left) .. +1 (right), from the direction relative to where you look.
 * A StereoPannerNode moves the sound between the two speakers: the simplest
 * form of 3D audio, and already enough to hear where the horde comes from.
 */
export interface Where {
  volume: number;
  pan: number;
}

function placeSound(where: Where): AudioNode | null {
  if (!ctx || where.volume < 0.02) return null;
  const gain = ctx.createGain();
  gain.gain.value = where.volume;
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, where.pan));
  gain.connect(panner).connect(master);
  return gain;
}

/**
 * Ghoul groan: a low buzzing "voice" (sawtooth wave) with a wobble
 * (vibrato: a slow oscillator modulating the pitch), filtered to sound like
 * a throat, plus some breath noise. Pitch and length vary every time.
 */
/**
 * Voice limit: at most this many groans at the same time. Not an
 * optimization: a horde of 50 groaning together is just noise, and you'd
 * lose the information "there's one right behind me". The quietest (farthest)
 * ones simply don't play.
 */
const MAX_GROANS = 4;
let groansPlaying = 0;

export function playGroan(where: Where, pitch = 1): void {
  if (groansPlaying >= MAX_GROANS || where.volume < 0.08) return;
  const out = placeSound(where);
  if (!ctx || !out) return;
  const t0 = ctx.currentTime;
  const dur = 0.8 + Math.random() * 0.6;
  groansPlaying++;
  setTimeout(() => groansPlaying--, dur * 1000);
  const f0 = (80 + Math.random() * 40) * pitch;

  const voice = ctx.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(f0, t0);
  voice.frequency.exponentialRampToValueAtTime(f0 * 0.75, t0 + dur); // the groan sinks

  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5 + Math.random() * 3;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = f0 * 0.06;
  vibrato.connect(vibratoDepth).connect(voice.frequency); // LFO → pitch

  const throat = ctx.createBiquadFilter(); // a "formant": the resonance of a mouth
  throat.type = 'bandpass';
  throat.frequency.value = 500 + Math.random() * 200;
  throat.Q.value = 1.5;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.001, t0);
  env.gain.exponentialRampToValueAtTime(0.5, t0 + 0.12);
  env.gain.setValueAtTime(0.5, t0 + dur * 0.6);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

  voice.connect(throat).connect(env).connect(out);
  voice.start(t0);
  vibrato.start(t0);
  voice.stop(t0 + dur);
  vibrato.stop(t0 + dur);
  noiseBurst({ out, duration: dur, volume: 0.12, filter: 'bandpass', frequency: 1200, q: 1 }); // breath
}

/** Claw swipe: a quick "whoosh" (noise whose filter sweeps up). */
export function playSwipe(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.25, volume: 0.5, filter: 'bandpass', frequency: 400, frequencyEnd: 2600, q: 2 });
}

/** Ghoul dies: a lower, sinking groan and a wet splat. */
export function playGhoulDeath(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  playGroan(where, 0.7);
  noiseBurst({ out, duration: 0.2, volume: 0.5, filter: 'lowpass', frequency: 900, frequencyEnd: 200 });
}

/** The player gets hit: a heavy thud and a short grunt. */
export function playPlayerHurt(): void {
  thump({ duration: 0.2, volume: 0.9, from: 140, to: 45 });
  noiseBurst({ duration: 0.12, volume: 0.5, filter: 'lowpass', frequency: 700 });
  thump({ start: 0.02, duration: 0.15, volume: 0.25, from: 220, to: 150 }); // "ugh"
}

/**
 * Church bell: the same "ring" as the targets (inharmonic partials), much
 * lower and with a long decay. Tolled `times` times, `gap` seconds apart.
 */
export function playBell(times: number, base = 160, gap = 1.1): void {
  if (!ctx) return;
  for (let i = 0; i < times; i++) {
    setTimeout(() => {
      ring(base, 3.5, 0.5);
      thump({ duration: 0.15, volume: 0.25, from: base * 2, to: base });
    }, i * gap * 1000);
  }
}

/**
 * Headshot: it must FEEL different. A sharp, bright crack, a wet pop, and a
 * short high "tink" on top: a sound you learn to chase.
 */
export function playHeadshot(kill: boolean): void {
  noiseBurst({ duration: 0.06, volume: 0.9, filter: 'highpass', frequency: 2500 });
  thump({ duration: 0.12, volume: 0.6, from: 300, to: 90 });
  ring(1900, 0.35, kill ? 0.3 : 0.18);
  if (kill) noiseBurst({ start: 0.03, duration: 0.25, volume: 0.45, filter: 'lowpass', frequency: 1200, frequencyEnd: 250 });
}
