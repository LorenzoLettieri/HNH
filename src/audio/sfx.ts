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
/** Bus of all the "world" sounds, before the muffle filter (see initAudio). */
let world: GainNode;
/** Lowpass on the world sounds: wide open normally, closed for a moment when you get hit. */
let muffle: BiquadFilterNode;
let noiseBuffer: AudioBuffer;
/** How much of the sound goes into the canyon echo (0 = off). See initAudio. */
let echoSend: GainNode;

/** Canyon echo (HIGH NOON): seconds between repeats, how much of each repeat comes back, how loud. */
const ECHO_DELAY = 0.34;
const ECHO_FEEDBACK = 0.4;
const ECHO_WET = 0.55;

/** Getting hit: the muffle filter's cutoff, open and closed (Hz), and seconds to open back up. */
const MUFFLE_OPEN = 20000;
const MUFFLE_CLOSED = 350;
const MUFFLE_RECOVER = 0.7;

/**
 * Audio settings, set by the "Impostazioni" menu (src/settings.ts, saved in
 * localStorage). Change the volume with setVolume(), which applies it.
 */
export const sfxSettings = {
  /** Master volume as a gain (0..1), already on the loudness curve: see settings.ts. */
  volume: 0.5,
  /** Ringing in the ears after hard hits. */
  earRinging: true,
  /** The world goes muffled for a moment when you get hit. */
  hitMuffle: true,
};

/** Sets the master volume (gain 0..1) and applies it right away. */
export function setVolume(gain: number): void {
  sfxSettings.volume = gain;
  // A short ramp instead of a jump: dragging a slider in big steps would click.
  if (ctx) master.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
}

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

  // Every sound goes into `world`, then through `muffle` (a lowpass filter,
  // normally wide open at 20 kHz = it changes nothing) into the master volume.
  // When you get hit the filter closes for a moment: the world sounds
  // muffled, as if you were stunned. The sounds of the hit itself skip it
  // (they go straight to master), so they stay sharp over the dull world.
  //
  //   sounds ──▶ world ──▶ muffle ──┐
  //   your hit ─────────────────────┴──▶ master (volume) ──▶ speakers
  world = ctx.createGain();
  muffle = ctx.createBiquadFilter();
  muffle.type = 'lowpass';
  muffle.frequency.value = MUFFLE_OPEN;
  world.connect(muffle).connect(master);

  // The canyon echo, for HIGH NOON. Everything that goes to the speakers
  // also goes (through echoSend, silent until turned on) into a delay line
  // that FEEDS BACK into itself: each repeat goes around the loop again,
  // quieter (feedback < 1) and darker (a lowpass in the loop, like air
  // swallowing the highs of a far echo).
  //
  //   master ──▶ echoSend ──▶ delay ──▶ lowpass ──┬──▶ speakers
  //                             ▲                 │
  //                             └─── feedback ◀───┘
  //
  // (Web Audio forbids loops in the graph, unless there's a DelayNode in them.)
  echoSend = ctx.createGain();
  echoSend.gain.value = 0;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = ECHO_DELAY;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 1800;
  const feedback = ctx.createGain();
  feedback.gain.value = ECHO_FEEDBACK;
  master.connect(echoSend).connect(delay).connect(damp).connect(ctx.destination);
  damp.connect(feedback).connect(delay);

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
  src.connect(filter).connect(gain).connect(options.out ?? world);
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
  osc.connect(gain).connect(options.out ?? world);
  osc.start(t0);
  osc.stop(t0 + options.duration);
}

/** Revolver shot: a sharp crack, a heavy low boom, and a short echo tail. */
export function playShot(): void {
  if (!ctx) return;
  // Pitch varies a little at every shot: identical sounds feel robotic.
  const v = 0.9 + Math.random() * 0.2;
  noiseBurst({ duration: 0.08, volume: 0.9, filter: 'highpass', frequency: 1800 * v }); // crack
  noiseBurst({ duration: 0.35, volume: 1.0, filter: 'lowpass', frequency: 2500 * v, frequencyEnd: 200 }); // blast
  thump({ duration: 0.25, volume: 0.9, from: 150 * v, to: 40 }); // punch in the chest
  // Echo off the canyon walls: the same blast, quieter and darker, later.
  noiseBurst({ start: 0.18, duration: 0.5, volume: 0.18, filter: 'lowpass', frequency: 900, frequencyEnd: 150 });
}

/**
 * Shotgun blast: the same recipe as the revolver (crack + blast + punch +
 * echo) but everything bigger and LOWER: a wider, darker noise burst, a deeper
 * and longer punch, and a longer echo. Low frequencies = "heavy".
 */
export function playShotgun(): void {
  if (!ctx) return;
  const v = 0.92 + Math.random() * 0.16;
  noiseBurst({ duration: 0.1, volume: 0.8, filter: 'highpass', frequency: 1200 * v }); // crack
  noiseBurst({ duration: 0.55, volume: 1.2, filter: 'lowpass', frequency: 1600 * v, frequencyEnd: 120 }); // blast
  thump({ duration: 0.4, volume: 1.1, from: 110 * v, to: 28 }); // the shove in your shoulder
  thump({ duration: 0.12, volume: 0.5, from: 300 * v, to: 90 }); // the "body" of the boom
  noiseBurst({ start: 0.22, duration: 0.8, volume: 0.25, filter: 'lowpass', frequency: 700, frequencyEnd: 100 }); // echo
}

/**
 * Shotgun reload, timed on the animation (render/weapons/shotgunView.ts:
 * the barrels there are physics, so these moments are measured): the thumb
 * clicks the top lever, whoosh of the jerk down, CLACK of the barrels hitting
 * their stop, two spent shells "plink" out, two new ones slide in (thock,
 * thock), whoosh of the flick up, SNAP shut and the lever springing back.
 */
export function playShotgunReload(duration: number): void {
  const at = (k: number) => k * duration;
  noiseBurst({ start: at(0.01), duration: 0.03, volume: 0.3, filter: 'bandpass', frequency: 2600, q: 4 }); // lever
  noiseBurst({ start: at(0.05), duration: 0.08, volume: 0.15, filter: 'bandpass', frequency: 500, frequencyEnd: 1500, q: 1 }); // jerk
  noiseBurst({ start: at(0.135), duration: 0.06, volume: 0.6, filter: 'bandpass', frequency: 1300, q: 2 }); // barrels open
  thump({ start: at(0.135), duration: 0.05, volume: 0.3, from: 300, to: 160 });
  for (const k of [0.17, 0.21]) noiseBurst({ start: at(k), duration: 0.05, volume: 0.25, filter: 'bandpass', frequency: 5200, q: 8 }); // shells out
  for (const k of [0.56, 0.7]) {
    noiseBurst({ start: at(k), duration: 0.04, volume: 0.35, filter: 'bandpass', frequency: 900, q: 3 }); // shell in
    thump({ start: at(k), duration: 0.04, volume: 0.2, from: 250, to: 180 });
  }
  noiseBurst({ start: at(0.79), duration: 0.07, volume: 0.15, filter: 'bandpass', frequency: 1500, frequencyEnd: 500, q: 1 }); // flick
  noiseBurst({ start: at(0.86), duration: 0.07, volume: 0.8, filter: 'bandpass', frequency: 1500, q: 2 }); // snap shut
  thump({ start: at(0.86), duration: 0.06, volume: 0.4, from: 350, to: 150 });
  noiseBurst({ start: at(0.875), duration: 0.025, volume: 0.35, filter: 'bandpass', frequency: 3200, q: 5 }); // lever back
}

/**
 * The carbine's shot: the same recipe again, tuned between the two. A long
 * barrel means a SHARPER crack than the revolver (more highs) but a big
 * charge: a solid punch, and a long echo rolling off the canyon walls.
 */
export function playCarbineShot(): void {
  if (!ctx) return;
  const v = 0.92 + Math.random() * 0.16;
  noiseBurst({ duration: 0.06, volume: 1.0, filter: 'highpass', frequency: 2600 * v }); // crack
  noiseBurst({ duration: 0.4, volume: 1.1, filter: 'lowpass', frequency: 3000 * v, frequencyEnd: 180 }); // blast
  thump({ duration: 0.3, volume: 1.0, from: 170 * v, to: 38 }); // punch
  noiseBurst({ start: 0.22, duration: 0.7, volume: 0.24, filter: 'lowpass', frequency: 1000, frequencyEnd: 140 }); // echo...
  noiseBurst({ start: 0.55, duration: 0.9, volume: 0.1, filter: 'lowpass', frequency: 650, frequencyEnd: 110 }); // ...and farther
}

/** When the moments of the lever cycle happen, seconds after the shot (computed by rifleView.ts). */
export interface LeverTimes {
  throwAt: number; // the hand starts throwing it open
  openAt: number; // it slams into its open stop
  ejectAt: number; // the spent case flies out
  shutStart: number; // the hand slams it back
  shutAt: number; // it slams into the frame and latches
}

/**
 * The carbine's lever, timed on the animation (render/weapons/rifleView.ts,
 * where the lever is physics: these times come from its numbers): the bolt
 * scraping back, a bright CLA- when it hits the open stop, the case spinning
 * out (a high "tink", and it lands a bit later), the bolt scraping forward
 * and a heavy -CLACK when it slams shut, with the little click of the latch.
 * The open hit is light and high, the shut one heavy and low: that contrast
 * is what makes the "cla-CLACK".
 */
export function playCarbineLever(t: LeverTimes): void {
  noiseBurst({ start: t.throwAt, duration: t.openAt - t.throwAt + 0.01, volume: 0.12, filter: 'bandpass', frequency: 1200, frequencyEnd: 3200, q: 2 }); // scrape back
  noiseBurst({ start: t.openAt, duration: 0.04, volume: 0.6, filter: 'bandpass', frequency: 2600, q: 3 }); // CLA-
  thump({ start: t.openAt, duration: 0.035, volume: 0.22, from: 700, to: 350 });
  noiseBurst({ start: t.ejectAt, duration: 0.05, volume: 0.22, filter: 'bandpass', frequency: 6000, q: 10 }); // case out
  noiseBurst({ start: t.shutStart, duration: t.shutAt - t.shutStart + 0.01, volume: 0.12, filter: 'bandpass', frequency: 3000, frequencyEnd: 1000, q: 2 }); // scrape forward
  noiseBurst({ start: t.shutAt, duration: 0.07, volume: 1.0, filter: 'bandpass', frequency: 1400, q: 2 }); // -CLACK
  thump({ start: t.shutAt, duration: 0.07, volume: 0.5, from: 360, to: 140 });
  noiseBurst({ start: t.shutAt + 0.012, duration: 0.02, volume: 0.3, filter: 'bandpass', frequency: 4200, q: 6 }); // latch
  // The case hits the ground somewhere behind you, and bounces once.
  for (const [k, vol] of [[0.42, 0.12], [0.5, 0.06]]) {
    noiseBurst({ start: t.ejectAt + k, duration: 0.03, volume: vol, filter: 'bandpass', frequency: 6400 + Math.random() * 800, q: 12 });
  }
}

/** Carbine reload, the start: the gun is turned over to show the loading gate. */
export function playCarbineReloadStart(): void {
  noiseBurst({ duration: 0.15, volume: 0.25, filter: 'bandpass', frequency: 600, frequencyEnd: 1300, q: 1.5 });
}

/** A round pushed in through the loading gate: the gate's spring clicks, the round thocks into the tube. */
export function playCarbineRoundIn(): void {
  noiseBurst({ duration: 0.02, volume: 0.3, filter: 'bandpass', frequency: 3800, q: 6 }); // gate
  noiseBurst({ start: 0.015, duration: 0.05, volume: 0.35, filter: 'bandpass', frequency: 900, q: 3 }); // thock
  thump({ start: 0.015, duration: 0.05, volume: 0.2, from: 260, to: 170 });
}

/**
 * Card "Duellante": the double-damage shot is ready. A dry "tic" (a short
 * click through a narrow filter) and a faint metallic ring after it (a
 * very high Q makes filtered noise ring like a tiny bell).
 */
export function playDuelReady(): void {
  noiseBurst({ duration: 0.015, volume: 0.35, filter: 'bandpass', frequency: 4200, q: 8 });
  noiseBurst({ start: 0.01, duration: 0.35, volume: 0.25, filter: 'bandpass', frequency: 2600, q: 60 });
}

/** Weapon switch: a leather-and-metal rustle as the new gun comes up. */
export function playWeaponSwitch(): void {
  noiseBurst({ duration: 0.12, volume: 0.3, filter: 'bandpass', frequency: 700, frequencyEnd: 1500, q: 1.5 });
  noiseBurst({ start: 0.1, duration: 0.03, volume: 0.25, filter: 'bandpass', frequency: 2800, q: 4 });
}

/** Empty cylinder: the hammer falls on nothing. */
export function playDryFire(): void {
  noiseBurst({ duration: 0.03, volume: 0.5, filter: 'bandpass', frequency: 3500, q: 4 });
  thump({ duration: 0.04, volume: 0.2, from: 900, to: 500 });
}

/**
 * The gunslinger's reload of the revolver, timed on the animation
 * (render/weapons/revolverReload.ts: same fractions of the reload time; the
 * cylinder there is physics, so these are measured: it hits its open stop
 * at ~0.105 and latches shut at ~0.825):
 * whoosh of the flick + CLACK of the crane hitting its stop, the ejector
 * click, six brass cases tinkling on the ground, six rounds clicking in,
 * whoosh + SNAP of the cylinder shutting, and the ratchet of the spin,
 * slowing down.
 */
export function playReload(duration: number): void {
  const at = (k: number) => k * duration;
  // Flick open.
  noiseBurst({ start: at(0.04), duration: 0.08, volume: 0.15, filter: 'bandpass', frequency: 600, frequencyEnd: 1800, q: 1 });
  noiseBurst({ start: at(0.105), duration: 0.05, volume: 0.5, filter: 'bandpass', frequency: 2200, q: 3 });
  thump({ start: at(0.105), duration: 0.04, volume: 0.2, from: 500, to: 250 });
  // Ejector rod.
  noiseBurst({ start: at(0.16), duration: 0.03, volume: 0.3, filter: 'bandpass', frequency: 3000, q: 4 });
  // Six empty cases falling: high, short "tink"s, a bit scattered in time.
  for (let i = 0; i < 6; i++) {
    const k = 0.24 + i * 0.012 + Math.random() * 0.03;
    noiseBurst({ start: at(k), duration: 0.03, volume: 0.15, filter: 'bandpass', frequency: 5500 + Math.random() * 1500, q: 10 });
  }
  // Six rounds in: the end of each slide (INSERT_START 0.38, INSERT_TIME 0.055).
  for (let i = 0; i < 6; i++) {
    const k = 0.38 + (i + 1) * 0.055 - 0.012;
    noiseBurst({ start: at(k), duration: 0.025, volume: 0.22, filter: 'bandpass', frequency: 4000, q: 6 });
  }
  // Flick shut: whoosh and a heavy SNAP.
  noiseBurst({ start: at(0.78), duration: 0.07, volume: 0.15, filter: 'bandpass', frequency: 1800, frequencyEnd: 600, q: 1 });
  noiseBurst({ start: at(0.825), duration: 0.06, volume: 0.7, filter: 'bandpass', frequency: 1600, q: 2 });
  thump({ start: at(0.825), duration: 0.05, volume: 0.35, from: 400, to: 200 });
  // The spin: ratchet clicks further and further apart.
  let k = 0.86;
  for (let gap = 0.012; k < 0.99; gap *= 1.35) {
    noiseBurst({ start: at(k), duration: 0.012, volume: 0.12, filter: 'bandpass', frequency: 3600, q: 6 });
    k += gap;
  }
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
    osc.connect(gain).connect(world);
    osc.start(t0);
    osc.stop(t0 + duration);
  }
}

/**
 * You picked something up. Each kind has its own sound, so you know what you
 * got without looking at the HUD:
 * - bullets: a handful of small cartridges clinking (quick high clicks + a tiny ring);
 * - shells: two heavier clacks, lower;
 * - medkit: a cork pop and a warm, rising chime (two rings, the second higher).
 */
export function playPickup(kind: 'bullets' | 'shells' | 'medkit' | 'coin'): void {
  if (kind === 'coin') {
    // "Ka-ching": a tiny metallic tick, then two bright bells a fifth apart
    // (the second higher, so it sounds like a reward, not an alarm).
    noiseBurst({ duration: 0.015, volume: 0.25, filter: 'highpass', frequency: 6000 });
    ring(1760, 0.15, 0.06);
    setTimeout(() => ring(2640, 0.35, 0.07), 55);
  } else if (kind === 'bullets') {
    for (let i = 0; i < 3; i++) {
      noiseBurst({ start: i * 0.045, duration: 0.02, volume: 0.35, filter: 'bandpass', frequency: 5000 - i * 600, q: 8 });
    }
    ring(2200, 0.2, 0.08);
  } else if (kind === 'shells') {
    for (let i = 0; i < 2; i++) {
      noiseBurst({ start: i * 0.08, duration: 0.04, volume: 0.5, filter: 'bandpass', frequency: 1800, q: 4 });
      thump({ start: i * 0.08, duration: 0.05, volume: 0.25, from: 500, to: 250 });
    }
  } else {
    thump({ duration: 0.06, volume: 0.4, from: 900, to: 300 }); // pop!
    ring(660, 0.5, 0.12);
    setTimeout(() => ring(990, 0.6, 0.12), 90);
  }
}

/**
 * Purchase: a cash register. A rattle of coins poured on the counter (a few
 * quick high ticks), the drawer's bell ("ka-ching": two bright rings), and a
 * low "clunk" of the gun put down on the wood.
 */
export function playPurchase(): void {
  for (let i = 0; i < 6; i++) {
    noiseBurst({ start: i * 0.035 + Math.random() * 0.01, duration: 0.02, volume: 0.25, filter: 'bandpass', frequency: 4500 + Math.random() * 2500, q: 10 });
  }
  setTimeout(() => ring(1760, 0.4, 0.09), 220);
  setTimeout(() => ring(2640, 0.7, 0.1), 290);
  thump({ start: 0.5, duration: 0.12, volume: 0.45, from: 180, to: 70 });
  noiseBurst({ start: 0.5, duration: 0.06, volume: 0.3, filter: 'lowpass', frequency: 900 });
}

/** Not enough money: a dull, short "no" (two low thuds, the second lower). */
export function playPurchaseDenied(): void {
  thump({ duration: 0.09, volume: 0.4, from: 220, to: 160 });
  thump({ start: 0.12, duration: 0.14, volume: 0.4, from: 160, to: 100 });
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
  gain.connect(panner).connect(world);
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

/**
 * Ghoul about to pounce: a short, shrill screech that RISES in pitch (a
 * groan sinks, this goes up: it's the "watch out" sound). Not limited like
 * the groans: it's a warning, it must always play.
 */
export function playLungeScreech(where: Where): void {
  const out = placeSound(where);
  if (!ctx || !out) return;
  const t0 = ctx.currentTime;
  const dur = 0.35;
  const voice = ctx.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(260, t0);
  voice.frequency.exponentialRampToValueAtTime(620, t0 + dur);
  const throat = ctx.createBiquadFilter();
  throat.type = 'bandpass';
  throat.frequency.value = 1400;
  throat.Q.value = 2;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.001, t0);
  env.gain.exponentialRampToValueAtTime(0.45, t0 + 0.05);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  voice.connect(throat).connect(env).connect(out);
  voice.start(t0);
  voice.stop(t0 + dur);
  noiseBurst({ out, duration: dur, volume: 0.15, filter: 'highpass', frequency: 2500 }); // hiss
}

/**
 * Hellhound starts its ambush: a short HOWL that rises, holds with a wobble,
 * then falls. It's the warning that something is charging you from where
 * you aren't looking: panned like every enemy sound, so you know where to
 * turn. Never skipped (it's a warning).
 */
export function playHowl(where: Where): void {
  const out = placeSound(where);
  if (!ctx || !out) return;
  const t0 = ctx.currentTime;
  const dur = 0.7;
  const voice = ctx.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(220, t0);
  voice.frequency.exponentialRampToValueAtTime(440, t0 + 0.15); // rises...
  voice.frequency.setValueAtTime(440, t0 + 0.45); // ...holds...
  voice.frequency.exponentialRampToValueAtTime(300, t0 + dur); // ...falls
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 7;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = 18;
  vibrato.connect(vibratoDepth).connect(voice.frequency);
  // A "formant" (mouth resonance) makes the sawtooth sound like a throat.
  const throat = ctx.createBiquadFilter();
  throat.type = 'bandpass';
  throat.frequency.value = 900;
  throat.Q.value = 3;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.001, t0);
  env.gain.exponentialRampToValueAtTime(0.7, t0 + 0.08);
  env.gain.setValueAtTime(0.7, t0 + 0.45);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  voice.connect(throat).connect(env).connect(out);
  voice.start(t0);
  vibrato.start(t0);
  voice.stop(t0 + dur);
  vibrato.stop(t0 + dur);
  noiseBurst({ out, duration: 0.4, volume: 0.15, filter: 'bandpass', frequency: 1800, q: 1 }); // breath
}

/**
 * Bull aims a charge: the WARNING. Two hoof scrapes on the ground (short
 * low-passed noise, sweeping down) and a heavy snort through the nostrils
 * (a burst of bandpassed noise, like blowing air). Spread over `duration`
 * (the aim time), so the last scrape tells you it's about to go.
 */
export function playBullSnort(where: Where, duration: number): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.18, volume: 0.6, filter: 'lowpass', frequency: 1400, frequencyEnd: 300 });
  noiseBurst({ out, start: 0.15, duration: 0.35, volume: 0.7, filter: 'bandpass', frequency: 700, frequencyEnd: 350, q: 1.5 });
  noiseBurst({ out, start: duration * 0.55, duration: 0.18, volume: 0.6, filter: 'lowpass', frequency: 1400, frequencyEnd: 300 });
  noiseBurst({ out, start: duration * 0.6, duration: 0.3, volume: 0.8, filter: 'bandpass', frequency: 800, frequencyEnd: 400, q: 1.5 });
}

/**
 * Bull charges: a deep BELLOW (two detuned sawtooth waves through a low
 * "throat" filter: detuning makes them beat, a rough, big voice) plus a
 * rumble of hooves (low thumps in quick succession).
 */
export function playBullBellow(where: Where): void {
  const out = placeSound(where);
  if (!ctx || !out) return;
  const t0 = ctx.currentTime;
  const dur = 0.9;
  const throat = ctx.createBiquadFilter();
  throat.type = 'bandpass';
  throat.frequency.value = 400;
  throat.Q.value = 2;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.001, t0);
  env.gain.exponentialRampToValueAtTime(0.9, t0 + 0.1);
  env.gain.setValueAtTime(0.9, t0 + 0.5);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  throat.connect(env).connect(out);
  for (const f of [70, 73.5]) {
    const voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(f, t0);
    voice.frequency.exponentialRampToValueAtTime(f * 1.4, t0 + 0.3); // rises...
    voice.frequency.exponentialRampToValueAtTime(f * 0.9, t0 + dur); // ...and sinks
    voice.connect(throat);
    voice.start(t0);
    voice.stop(t0 + dur);
  }
  for (let i = 0; i < 6; i++) thump({ out, start: i * 0.13, duration: 0.1, volume: 0.5, from: 90, to: 45 }); // hooves
}

/** Bull slams into a wall: a big low BOOM and a crunch of wood. */
export function playBullCrash(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  thump({ out, duration: 0.45, volume: 1.2, from: 110, to: 30 });
  noiseBurst({ out, duration: 0.4, volume: 0.9, filter: 'lowpass', frequency: 2500, frequencyEnd: 200 });
  noiseBurst({ out, start: 0.05, duration: 0.25, volume: 0.4, filter: 'bandpass', frequency: 1800, q: 3 }); // splinters
}

/** Ghoul dies: a lower, sinking groan and a wet splat. */
export function playGhoulDeath(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  playGroan(where, 0.7);
  noiseBurst({ out, duration: 0.2, volume: 0.5, filter: 'lowpass', frequency: 900, frequencyEnd: 200 });
}

/** The leg swings: a short, low whoosh of air (lower and shorter than the claws). */
export function playKickSwing(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.18, volume: 0.8, filter: 'bandpass', frequency: 350, frequencyEnd: 1600, q: 1.2 });
  thump({ duration: 0.08, volume: 0.25, from: 90, to: 60 }); // the body's weight shifting
}

/**
 * The boot connects: a heavy, dull THUD (a low sine dropping fast, like the
 * shot's punch but without the crack) plus a short muffled slap of noise.
 * More things hit = a bit louder.
 */
export function playKickImpact(hits: number): void {
  if (!ctx) return;
  const v = 0.9 + Math.random() * 0.2;
  const loud = Math.min(1, 0.7 + hits * 0.1);
  thump({ duration: 0.22, volume: loud, from: 110 * v, to: 35 });
  noiseBurst({ duration: 0.09, volume: 0.6 * loud, filter: 'lowpass', frequency: 1400 * v, frequencyEnd: 250 });
}

/**
 * The shovel goes up and comes down. A heavier, lower whoosh than the boot
 * (a wide flat blade pushes more air): a band of noise sweeping UP in pitch
 * as it speeds up, timed to peak right at the impact (`impact` = seconds
 * from now, the simulation's wind-up). Plus the creak of the wooden shaft
 * at the top of the swing.
 */
export function playShovelSwing(impact: number): void {
  if (!ctx) return;
  const v = 0.9 + Math.random() * 0.2;
  // The creak: a short, narrow, mid-low band of noise at the top of the swing.
  noiseBurst({ duration: 0.06, volume: 0.25, filter: 'bandpass', frequency: 600 * v, q: 6 });
  // The whoosh: it starts quiet and swells into the impact. noiseBurst only
  // decays, so we build it by hand: a gain ramping UP (exponentially: loudness
  // is heard on a log scale), the filter sweeping up with it.
  const t0 = ctx.currentTime + impact * 0.35;
  const t1 = ctx.currentTime + impact;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(220 * v, t0);
  filter.frequency.exponentialRampToValueAtTime(900 * v, t1);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, t0);
  gain.gain.exponentialRampToValueAtTime(0.9, t1);
  gain.gain.exponentialRampToValueAtTime(0.001, t1 + 0.08);
  src.connect(filter).connect(gain).connect(world);
  src.start(t0, Math.random() * 0.5, t1 + 0.1 - t0);
}

/**
 * The shovel hits: a cartoon frying-pan BONK. Three layers:
 * - a dull thud (the blow on the body);
 * - the clang of the blade: the metallic partials of ring(), short;
 * - the "DOIIING": a low tone whose pitch WOBBLES (vibrato) and settles,
 *   like a sheet of metal still shaking. Vibrato = a second, slow oscillator
 *   (an LFO, "low frequency oscillator") connected to the first one's
 *   frequency: it pushes it up and down 16 times a second, and its depth
 *   fades out with the vibration.
 * More things hit = louder.
 */
export function playShovelBonk(hits: number): void {
  if (!ctx) return;
  const v = 0.92 + Math.random() * 0.16;
  const loud = Math.min(1, 0.75 + hits * 0.1);
  thump({ duration: 0.2, volume: 0.9 * loud, from: 140 * v, to: 45 });
  noiseBurst({ duration: 0.05, volume: 0.5 * loud, filter: 'highpass', frequency: 2500 }); // the slap
  ring(520 * v, 0.5, 0.18 * loud);

  const t0 = ctx.currentTime;
  const base = 190 * v;
  const osc = ctx.createOscillator();
  osc.type = 'triangle'; // a bit brighter than a sine: it reads as metal, not as a hum
  osc.frequency.setValueAtTime(base * 1.25, t0); // starts sharp, falls onto its pitch: "dOIng"
  osc.frequency.exponentialRampToValueAtTime(base, t0 + 0.08);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 16;
  const depth = ctx.createGain(); // how far the LFO pushes the pitch, in Hz
  depth.gain.setValueAtTime(base * 0.12, t0);
  depth.gain.exponentialRampToValueAtTime(1, t0 + 0.6);
  lfo.connect(depth).connect(osc.frequency);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.45 * loud, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.65);
  osc.connect(gain).connect(world);
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + 0.7);
  lfo.stop(t0 + 0.7);
}

/**
 * The player gets hit. `strength` 0..1 (from the damage). Layers:
 * a heavy body blow (sine dropping very low), a wet smack of flesh (band of
 * noise), a dry crack on top, a short grunt; for hard hits a ringing in the
 * ears. All of it goes straight to master, while the rest of the world is
 * muffled for a moment (the filter closes at once and opens up slowly).
 */
export function playPlayerHurt(strength: number): void {
  if (!ctx) return;
  const v = 0.6 + 0.4 * strength;
  thump({ out: master, duration: 0.4, volume: 1.1 * v, from: 120, to: 30 }); // body blow
  noiseBurst({ out: master, duration: 0.11, volume: 0.9 * v, filter: 'bandpass', frequency: 1400, frequencyEnd: 400, q: 1.5 }); // smack
  noiseBurst({ out: master, duration: 0.035, volume: 0.4 * v, filter: 'highpass', frequency: 3500 }); // crack
  thump({ out: master, start: 0.03, duration: 0.16, volume: 0.3 * v, from: 230, to: 140 }); // "ugh"
  // Ringing in the ears: a thin high sine, fading slowly. Only for hard hits.
  if (strength >= 0.5 && sfxSettings.earRinging) {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.value = 3600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.05 * strength, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + 1.6);
  }
  // The world goes dull: close the filter at once (lower = more muffled for
  // harder hits), then open it back up. Exponential ramp: frequencies are
  // heard on a log scale, so it sounds like a steady "opening".
  if (!sfxSettings.hitMuffle) return;
  const t0 = ctx.currentTime;
  const closed = MUFFLE_CLOSED * (2.5 - 1.5 * strength);
  muffle.frequency.cancelScheduledValues(t0);
  muffle.frequency.setValueAtTime(closed, t0);
  muffle.frequency.exponentialRampToValueAtTime(MUFFLE_OPEN, t0 + MUFFLE_RECOVER * (0.6 + 0.4 * strength));
}

/** One heartbeat thump (low health): a very low, soft sine "boom", felt more than heard. */
export function playHeartbeat(volume: number): void {
  thump({ out: master, duration: 0.16, volume: 0.55 * volume, from: 75, to: 38 }); // not muffled: it is you
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

/**
 * Eye-bat charging a shot: a whine that rises in pitch and volume for the
 * whole charge, with a fast tremolo (a second oscillator wobbling the volume).
 * It's the audio half of the warning: you hear it even behind you.
 */
export function playEyebatCharge(where: Where, duration: number): void {
  const out = placeSound(where);
  if (!ctx || !out) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.exponentialRampToValueAtTime(880, t0 + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, t0);
  gain.gain.exponentialRampToValueAtTime(0.35, t0 + duration);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration + 0.05);
  // Tremolo: an LFO (low-frequency oscillator, 18 Hz) added to the gain.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 18;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.12;
  lfo.connect(lfoDepth).connect(gain.gain);
  osc.connect(gain).connect(out);
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + duration + 0.06);
  lfo.stop(t0 + duration + 0.06);
}

/** Eye-bat fires: a fiery whoosh with a low puff. */
export function playFireball(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.45, volume: 0.7, filter: 'bandpass', frequency: 1800, frequencyEnd: 300, q: 1.5 });
  thump({ out, duration: 0.2, volume: 0.5, from: 220, to: 60 });
}

/** A fireball bursts against something: a crackling, sizzling pop. */
export function playFireballHit(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.3, volume: 0.8, filter: 'lowpass', frequency: 3000, frequencyEnd: 250 });
  noiseBurst({ out, start: 0.05, duration: 0.4, volume: 0.25, filter: 'highpass', frequency: 4000 }); // sizzle
}

/**
 * Sharpshooter starts aiming: the rifle goes to the shoulder (a rustle and a
 * dry "tok" of wood on bone) and the laser sight turns on with a thin
 * electric WHINE that rises for the whole aim (`duration`). The fast vibrato
 * (30 Hz on the pitch) makes it buzz like a wire instead of whistle.
 *
 * Unlike the other warnings this one can be cut short: if you hide, it gives
 * up. So it returns a function that stops it, a "handle" to a sound that is
 * already playing. The stop goes through a gain of its own in series
 * (stopGain): fading THAT one out leaves the whine's own envelope untouched,
 * so we don't have to undo ramps already scheduled on it.
 */
export function playSharpshooterAim(where: Where, duration: number): () => void {
  const out = placeSound(where);
  if (!ctx || !out) return () => {};
  const audio = ctx;
  const t0 = audio.currentTime;
  const end = t0 + duration + 0.1;
  noiseBurst({ out, duration: 0.12, volume: 0.35, filter: 'bandpass', frequency: 900, frequencyEnd: 1800, q: 1.5 }); // rustle
  noiseBurst({ out, start: 0.1, duration: 0.04, volume: 0.5, filter: 'bandpass', frequency: 1300, q: 5 }); // tok

  const whine = audio.createOscillator(); // a sine: thin and pure, like a beam of light
  whine.frequency.setValueAtTime(1000, t0);
  whine.frequency.exponentialRampToValueAtTime(1600, t0 + duration);
  const vibrato = audio.createOscillator();
  vibrato.frequency.value = 30;
  const vibratoDepth = audio.createGain();
  vibratoDepth.gain.value = 14;
  vibrato.connect(vibratoDepth).connect(whine.frequency);
  const env = audio.createGain();
  env.gain.setValueAtTime(0.001, t0);
  env.gain.exponentialRampToValueAtTime(0.05, t0 + 0.15);
  env.gain.exponentialRampToValueAtTime(0.13, t0 + duration);
  env.gain.exponentialRampToValueAtTime(0.001, end);
  const stopGain = audio.createGain();
  whine.connect(env).connect(stopGain).connect(out);
  whine.start(t0);
  vibrato.start(t0);
  whine.stop(end);
  vibrato.stop(end);

  let stopped = false;
  return () => {
    const now = audio.currentTime;
    if (stopped || now >= end) return;
    stopped = true;
    // A fast fade (time constant 20 ms) rather than a cut: an instant jump to 0 clicks.
    stopGain.gain.setTargetAtTime(0, now, 0.02);
    whine.stop(now + 0.15);
    vibrato.stop(now + 0.15);
  };
}

/**
 * The Winchester's lever, cla-CLACK: thrown down (a sharp metal clack and the
 * tinkle of the spent shell) and snapped back up at `upAt` seconds (a heavier
 * clack: a new round goes in), then the shell bouncing on the ground. It plays
 * at the LOCK, so it's the sound that means "MOVE, NOW": the shot follows.
 */
export function playLeverAction(where: Where, upAt: number): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.04, volume: 0.7, filter: 'bandpass', frequency: 2400, q: 3 }); // cla-
  thump({ out, duration: 0.04, volume: 0.25, from: 600, to: 300 });
  noiseBurst({ out, start: 0.05, duration: 0.05, volume: 0.25, filter: 'bandpass', frequency: 5600, q: 9 }); // the shell flies out
  noiseBurst({ out, start: upAt, duration: 0.06, volume: 0.9, filter: 'bandpass', frequency: 1500, q: 2 }); // -CLACK
  thump({ out, start: upAt, duration: 0.06, volume: 0.4, from: 380, to: 160 });
  noiseBurst({ out, start: upAt + 0.18, duration: 0.03, volume: 0.12, filter: 'bandpass', frequency: 6200, q: 10 }); // it lands
}

/**
 * The sharpshooter's shot. A rifle is SHARPER than the revolver (faster
 * bullet, longer barrel): more high crack, less boom. And it shoots from afar,
 * so the long echo rolling off the canyon walls matters: you hear the place.
 */
export function playRifleShot(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  const v = 0.92 + Math.random() * 0.16;
  noiseBurst({ out, duration: 0.05, volume: 1.0, filter: 'highpass', frequency: 3000 * v }); // crack
  noiseBurst({ out, duration: 0.25, volume: 0.8, filter: 'lowpass', frequency: 3500 * v, frequencyEnd: 300 }); // blast
  thump({ out, duration: 0.18, volume: 0.6, from: 200 * v, to: 55 });
  noiseBurst({ out, start: 0.25, duration: 0.6, volume: 0.25, filter: 'lowpass', frequency: 1100, frequencyEnd: 150 }); // echo
  noiseBurst({ out, start: 0.6, duration: 0.8, volume: 0.12, filter: 'lowpass', frequency: 700, frequencyEnd: 120 }); // and farther
}

/**
 * A bullet glances off a wall: the western "PTIIING". A sine whistle whose
 * pitch FALLS (the bullet spins away, and moving away from you its sound
 * drops: a Doppler effect, roughly), over the short smack of the impact.
 */
export function playRicochet(where: Where): void {
  const out = placeSound(where);
  if (!ctx || !out) return;
  const t0 = ctx.currentTime;
  const f0 = 2600 + Math.random() * 1200;
  const dur = 0.3 + Math.random() * 0.15;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.45, t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.001, t0);
  env.gain.exponentialRampToValueAtTime(0.22, t0 + 0.015);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(env).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur);
  noiseBurst({ out, duration: 0.08, volume: 0.5, filter: 'bandpass', frequency: 2500, q: 1.5 }); // smack
}

/**
 * A skeleton collapses: a cascade of dry "toks" (bone on bone: very short
 * noise through a narrow bandpass = hard and woody, each at a different
 * pitch), quieter as it settles; the dull thud of the pile landing and the
 * metal clank of the rifle. Random timing is fine: it's not gameplay.
 */
export function playBoneClatter(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  let t = 0;
  for (let i = 0; i < 12; i++) {
    t += 0.025 + Math.random() * 0.06;
    const volume = 0.55 * (1 - i / 14);
    noiseBurst({ out, start: t, duration: 0.03, volume, filter: 'bandpass', frequency: 1400 + Math.random() * 1800, q: 6 });
  }
  thump({ out, start: 0.12, duration: 0.15, volume: 0.45, from: 140, to: 60 }); // the pile lands
  noiseBurst({ out, start: 0.22, duration: 0.12, volume: 0.35, filter: 'bandpass', frequency: 3200, q: 7 }); // the rifle: clank
  thump({ out, start: 0.22, duration: 0.05, volume: 0.25, from: 500, to: 300 });
}

/**
 * Turns the canyon echo on or off (HIGH NOON). Smoothly: setTargetAtTime
 * glides the volume towards the target (a sudden jump would click). Turning
 * it off only stops NEW sound from going in: the repeats already in the loop
 * die out on their own.
 */
export function setCanyonEcho(on: boolean): void {
  if (!ctx) return;
  echoSend.gain.setTargetAtTime(on ? ECHO_WET : 0, ctx.currentTime, 0.1);
}

/**
 * HIGH NOON starts: a huge church bell, much deeper and longer than the
 * waves' one (same metal "ring", with the heavy strike of the clapper), and
 * a duel whistle: a sine that glides up, holds with a vibrato (the wobble of
 * a real whistle) and falls, plus a little breath. Turn the canyon echo on
 * first: the whistle bounces off the canyon walls.
 */
export function playHighNoon(): void {
  if (!ctx) return;
  ring(82, 6, 0.55); // the bell
  thump({ duration: 0.7, volume: 0.9, from: 140, to: 35 }); // the clapper's strike

  const t0 = ctx.currentTime + 0.3; // the whistle comes in after the strike
  const end = t0 + 1.1;
  const whistle = ctx.createOscillator(); // a sine: the purest tone, like a whistle
  whistle.frequency.setValueAtTime(1000, t0);
  whistle.frequency.exponentialRampToValueAtTime(1570, t0 + 0.14); // up...
  whistle.frequency.setValueAtTime(1570, t0 + 0.6); // ...hold...
  whistle.frequency.exponentialRampToValueAtTime(1180, end - 0.1); // ...and down
  // Vibrato: a slow oscillator (6 Hz) that pushes the whistle's pitch up and down by ±22 Hz.
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 6;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = 22;
  vibrato.connect(vibratoDepth).connect(whistle.frequency);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.001, t0);
  env.gain.exponentialRampToValueAtTime(0.16, t0 + 0.05);
  env.gain.setValueAtTime(0.16, end - 0.3);
  env.gain.exponentialRampToValueAtTime(0.001, end);
  whistle.connect(env).connect(world);
  whistle.start(t0);
  vibrato.start(t0);
  whistle.stop(end);
  vibrato.stop(end);
  noiseBurst({ start: 0.3, duration: 1, volume: 0.05, filter: 'bandpass', frequency: 1500, q: 2 }); // breath
}

/**
 * HIGH NOON is over: the white-hot iron is quenched, like a blacksmith dipping
 * it in water. The sharp "ts" of the dip, a long burst of steam (noise through
 * a bandpass that sweeps down: from a hiss to a sigh), a dull splash, and a
 * little later the "tink" of the metal shrinking as it cools.
 */
export function playQuench(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.12, volume: 0.35, filter: 'highpass', frequency: 3000 }); // ts
  noiseBurst({ duration: 1.5, volume: 0.45, filter: 'bandpass', frequency: 6000, frequencyEnd: 1200, q: 0.8 }); // steam
  thump({ duration: 0.3, volume: 0.3, from: 90, to: 45 }); // splash
  setTimeout(() => ring(1250, 0.6, 0.05), 350); // tink
}

/**
 * Pause: suspends the whole AudioContext. Sounds already playing (a charge
 * whine, an echo) freeze where they are and continue on resume, in sync with
 * the frozen game.
 */
export function setAudioPaused(paused: boolean): void {
  if (!ctx) return;
  if (paused) void ctx.suspend();
  else void ctx.resume();
}
