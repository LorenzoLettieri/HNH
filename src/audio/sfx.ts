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
  src.connect(filter).connect(gain).connect(master);
  // Start at a random point of the noise so repeated sounds aren't identical.
  src.start(t0, Math.random() * 0.5, options.duration);
}

/** A sine "thump" whose pitch drops: the low punch of a shot or a click. */
function thump(options: { start?: number; duration: number; volume: number; from: number; to: number }): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + (options.start ?? 0);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(options.from, t0);
  osc.frequency.exponentialRampToValueAtTime(options.to, t0 + options.duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + options.duration);
  osc.connect(gain).connect(master);
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
