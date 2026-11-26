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
 * The revolver drawn (weapon switch, render/weapons/revolverDraw.ts): the
 * "whoom" of one turn round the finger, the grip slapping into the palm,
 * the hammer clicked back. Akimbo: the left gun does it all again a beat later.
 */
export function playRevolverDraw(t: { spinAt: number; catchAt: number; cockAt: number; leftLag: number }, akimbo: boolean): void {
  for (const lag of akimbo ? [0, t.leftLag] : [0]) {
    const quiet = lag > 0 ? 0.8 : 1;
    noiseBurst({ start: t.spinAt + lag, duration: t.catchAt - t.spinAt, volume: 0.16 * quiet, filter: 'bandpass', frequency: 500, frequencyEnd: 1400, q: 1.4 }); // whoom
    noiseBurst({ start: t.catchAt + lag, duration: 0.04, volume: 0.35 * quiet, filter: 'lowpass', frequency: 900 }); // slap in the palm
    thump({ start: t.catchAt + lag, duration: 0.04, volume: 0.2 * quiet, from: 200, to: 110 });
    noiseBurst({ start: t.cockAt + lag, duration: 0.02, volume: 0.35 * quiet, filter: 'bandpass', frequency: 3800, q: 6 }); // click
    noiseBurst({ start: t.cockAt + lag + 0.025, duration: 0.015, volume: 0.25 * quiet, filter: 'bandpass', frequency: 5200, q: 8 }); // ...clack
  }
}

/**
 * The double barrel drawn (weapon switch): a rush of air as it swings in
 * broken open, then the barrels SNAP shut (the same snap as the reload's
 * end) and the top lever springs back.
 */
export function playShotgunDraw(t: { snapAt: number }): void {
  noiseBurst({ duration: 0.12, volume: 0.14, filter: 'bandpass', frequency: 400, frequencyEnd: 1300, q: 1.2 }); // swing
  noiseBurst({ start: t.snapAt, duration: 0.07, volume: 0.8, filter: 'bandpass', frequency: 1500, q: 2 }); // snap shut
  thump({ start: t.snapAt, duration: 0.06, volume: 0.4, from: 350, to: 150 });
  noiseBurst({ start: t.snapAt + 0.015, duration: 0.025, volume: 0.35, filter: 'bandpass', frequency: 3200, q: 5 }); // lever back
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

/**
 * The carbine drawn (weapon switch, rifleView.ts): a rush of air as it swings
 * in with the lever open, the bolt scraping forward and the "-CLACK" of the
 * lever slammed shut (the second half of playCarbineLever), the latch.
 */
export function playCarbineDraw(t: { shutStart: number; shutAt: number }): void {
  noiseBurst({ duration: 0.12, volume: 0.14, filter: 'bandpass', frequency: 400, frequencyEnd: 1300, q: 1.2 }); // swing
  noiseBurst({ start: t.shutStart, duration: t.shutAt - t.shutStart + 0.01, volume: 0.12, filter: 'bandpass', frequency: 3000, frequencyEnd: 1000, q: 2 }); // scrape forward
  noiseBurst({ start: t.shutAt, duration: 0.07, volume: 1.0, filter: 'bandpass', frequency: 1400, q: 2 }); // -CLACK
  thump({ start: t.shutAt, duration: 0.07, volume: 0.5, from: 360, to: 140 });
  noiseBurst({ start: t.shutAt + 0.012, duration: 0.02, volume: 0.3, filter: 'bandpass', frequency: 4200, q: 6 }); // latch
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
 * The pump-action's pump, timed on the animation (render/weapons/pumpView.ts:
 * the fore-end is a Stroke, like the carbine's lever, so the same LeverTimes):
 * wood sliding back on the tube, "CH-" when it hits the rear stop, the spent
 * shell out (a duller sound than the carbine's brass: paper and a brass
 * head), the slide forward and a heavy "-CHK" when it's shoved home. Lower
 * and meatier than the lever: the "ch-CHK" every action movie taught us.
 */
export function playPumpRack(t: LeverTimes): void {
  // The whole gun flung onto its side (the flourish in pumpView.ts): a rush of air.
  whoosh(Math.max(0, t.throwAt - 0.03));
  pumpBack(t.throwAt, t.openAt);
  noiseBurst({ start: t.ejectAt, duration: 0.04, volume: 0.15, filter: 'bandpass', frequency: 3000, q: 5 }); // shell out
  pumpHome(t.shutStart, t.shutAt);
  // The shell lands somewhere behind you: a dull plastic "tock", and a smaller bounce.
  for (const [k, vol] of [[0.45, 0.12], [0.55, 0.05]]) {
    noiseBurst({ start: t.ejectAt + k, duration: 0.03, volume: vol, filter: 'bandpass', frequency: 1800 + Math.random() * 400, q: 5 });
  }
}

/** A rush of air: the gun flung around. */
function whoosh(start: number): void {
  noiseBurst({ start, duration: 0.12, volume: 0.14, filter: 'bandpass', frequency: 400, frequencyEnd: 1300, q: 1.2 });
}
/** The fore-end yanked back: wood sliding on the tube, "CH-" on the rear stop. */
function pumpBack(start: number, hit: number): void {
  noiseBurst({ start, duration: hit - start + 0.01, volume: 0.14, filter: 'bandpass', frequency: 700, frequencyEnd: 1800, q: 1.5 }); // slide back
  noiseBurst({ start: hit, duration: 0.05, volume: 0.6, filter: 'bandpass', frequency: 1900, q: 2.5 }); // CH-
  thump({ start: hit, duration: 0.04, volume: 0.3, from: 520, to: 260 });
}
/** The fore-end shoved home: the slide forward and the heavy "-CHK", the bolt locking. */
function pumpHome(start: number, hit: number): void {
  noiseBurst({ start, duration: hit - start + 0.01, volume: 0.14, filter: 'bandpass', frequency: 1800, frequencyEnd: 800, q: 1.5 }); // slide forward
  noiseBurst({ start: hit, duration: 0.08, volume: 1.0, filter: 'bandpass', frequency: 1100, q: 2 }); // -CHK
  thump({ start: hit, duration: 0.08, volume: 0.55, from: 300, to: 110 });
  noiseBurst({ start: hit + 0.01, duration: 0.02, volume: 0.3, filter: 'bandpass', frequency: 3600, q: 6 }); // the bolt locking
}

/** The pump-action's reload starts (pumpView.ts): the gun flung up, a rush of air. */
export function playPumpReloadStart(t: { flipAt: number }): void {
  whoosh(t.flipAt);
}

/**
 * A shell SLAPPED into the tube from below: the meaty slap of a gloved palm (low,
 * soft noise and a thud), the shell knocking into place, a tiny click.
 */
export function playPumpShellIn(): void {
  noiseBurst({ duration: 0.05, volume: 0.45, filter: 'lowpass', frequency: 900 }); // slap
  thump({ duration: 0.06, volume: 0.35, from: 180, to: 90 });
  noiseBurst({ start: 0.008, duration: 0.04, volume: 0.35, filter: 'bandpass', frequency: 1200, q: 3 }); // knock
  noiseBurst({ start: 0.02, duration: 0.015, volume: 0.2, filter: 'bandpass', frequency: 4200, q: 6 }); // click
}

/** The pump-action drawn (weapon switch): it swings in with the fore-end back and it's shoved home, "-CHK". */
export function playPumpDraw(t: { shutStart: number; shutAt: number }): void {
  whoosh(0);
  pumpHome(t.shutStart, t.shutAt);
}

/** The end of the reload: the hand back on the fore-end and a full rack, "ch-CHK" (it chambers a shell). */
export function playPumpClose(t: { yankAt: number; openAt: number; shutStart: number; shutAt: number }): void {
  pumpBack(t.yankAt, t.openAt);
  pumpHome(t.shutStart, t.shutAt);
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


/** Empty cylinder: the hammer falls on nothing. */
export function playDryFire(): void {
  noiseBurst({ duration: 0.03, volume: 0.5, filter: 'bandpass', frequency: 3500, q: 4 });
  thump({ duration: 0.04, volume: 0.2, from: 900, to: 500 });
}

/**
 * The akimbo spin reload (render/weapons/akimboSpin.ts), timed on its turns:
 * `turns` = when each turn of the right gun completes (spinTurnTimes), so
 * the sound follows the animation's easing. A quick rattle of the cylinders
 * at the start, a "whoom" of air for every turn of both guns (the left one a
 * moment later, quieter as the spin slows down), then the grips slapping into
 * the palms and the two hammers clicking: loaded.
 */
export function playAkimboSpin(turns: number[], duration: number): void {
  for (let i = 0; i < 6; i++) {
    noiseBurst({ start: 0.01 + i * 0.022, duration: 0.012, volume: 0.18, filter: 'highpass', frequency: 5000 });
  }
  turns.forEach((t, i) => {
    for (const late of [0, 0.07]) {
      noiseBurst({
        start: Math.max(0, t - 0.14) + late,
        duration: 0.16,
        volume: 0.4 - i * 0.08,
        filter: 'bandpass',
        frequency: 600,
        frequencyEnd: 1500,
        q: 2,
      });
    }
  });
  thump({ start: duration - 0.06, duration: 0.06, volume: 0.35, from: 320, to: 150 });
  thump({ start: duration - 0.02, duration: 0.06, volume: 0.3, from: 300, to: 140 });
  noiseBurst({ start: duration + 0.03, duration: 0.02, volume: 0.35, filter: 'bandpass', frequency: 3800, q: 6 });
  noiseBurst({ start: duration + 0.08, duration: 0.02, volume: 0.3, filter: 'bandpass', frequency: 3400, q: 6 });
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
function ring(base: number, duration: number, volume: number, out: AudioNode = world): void {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (const [ratio, gainRatio] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.12]]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = base * ratio * (0.98 + Math.random() * 0.04);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * gainRatio, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration / ratio ** 0.3);
    osc.connect(gain).connect(out);
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
export function playPickup(kind: 'bullets' | 'shells' | 'sticks' | 'medkit' | 'coin' | 'iron'): void {
  if (kind === 'iron') {
    // The Damned Iron: a heavy "clunk" of metal, then a low anvil ring that
    // lingers, and a breath of heat. Rare: it should sound like a prize.
    thump({ duration: 0.12, volume: 0.55, from: 160, to: 60 });
    ring(330, 1.4, 0.2);
    setTimeout(() => ring(495, 1.2, 0.12), 120);
    noiseBurst({ start: 0.1, duration: 0.6, volume: 0.15, filter: 'highpass', frequency: 2000 });
    return;
  }
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
  } else if (kind === 'sticks') {
    // A bundle of dynamite: three soft cardboard "toks" one after the other,
    // and a short hiss, as if a fuse caught for an instant (it didn't).
    for (let i = 0; i < 3; i++) thump({ start: i * 0.05, duration: 0.06, volume: 0.35, from: 300, to: 140 });
    noiseBurst({ start: 0.12, duration: 0.18, volume: 0.12, filter: 'bandpass', frequency: 4200, q: 1 });
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

/**
 * A gun reinforced at the Forge: three hammer blows on the anvil (a heavy
 * clang each, a bit higher every time, like the metal hardening), then the
 * hot iron plunged in water: a long hiss of steam.
 */
export function playForge(): void {
  for (let i = 0; i < 3; i++) {
    const at = i * 0.32;
    thump({ start: at, duration: 0.08, volume: 0.5, from: 200, to: 90 });
    noiseBurst({ start: at, duration: 0.03, volume: 0.35, filter: 'highpass', frequency: 3500 });
    setTimeout(() => ring(620 + i * 90, 0.9, 0.22), at * 1000);
  }
  noiseBurst({ start: 1.05, duration: 1.1, volume: 0.3, filter: 'highpass', frequency: 2500 });
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

/**
 * The Damned Smith raises its hammer (the warning): a scrape of iron rising
 * in pitch (the hammer dragged up) and a deep wheeze, like a bellows filling.
 */
export function playSmithWindup(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.7, volume: 0.6, filter: 'bandpass', frequency: 500, frequencyEnd: 2400, q: 4 });
  noiseBurst({ out, duration: 0.8, volume: 0.5, filter: 'lowpass', frequency: 300, frequencyEnd: 600 });
}

/**
 * The hammer hits the ground: the biggest thud in the game (a very low sine
 * falling), a crack of stone, and a long rumble while the shockwave spreads.
 */
export function playSmithSlam(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  thump({ out, duration: 0.6, volume: 1.4, from: 90, to: 25 });
  noiseBurst({ out, duration: 0.15, volume: 0.9, filter: 'highpass', frequency: 1500 }); // the crack
  noiseBurst({ out, start: 0.05, duration: 1.1, volume: 0.7, filter: 'lowpass', frequency: 400, frequencyEnd: 80 }); // rumble
}

/**
 * The chain swinging over its head (the hook's warning): a rhythmic "whoom...
 * whoom" (a band of noise sweeping up and down, three turns) with the rattle
 * of the links on top.
 */
export function playSmithHookSwing(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  for (let i = 0; i < 3; i++) {
    noiseBurst({ out, start: i * 0.22, duration: 0.2, volume: 0.5, filter: 'bandpass', frequency: 300, frequencyEnd: 900, q: 2 });
    noiseBurst({ out, start: i * 0.22 + 0.05, duration: 0.08, volume: 0.25, filter: 'bandpass', frequency: 4000, q: 6 });
  }
}

/** The hook flies: a sharp whistle and the chain unrolling (fast metallic ticks). */
export function playSmithHookThrow(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.35, volume: 0.5, filter: 'bandpass', frequency: 1500, frequencyEnd: 3500, q: 5 });
  for (let i = 0; i < 8; i++) {
    noiseBurst({ out, start: i * 0.04, duration: 0.015, volume: 0.25, filter: 'highpass', frequency: 5000 });
  }
}

/** The hook bites you: a heavy CLANK close to your ears and a yank. Not positional: it's in you. */
export function playSmithHookHit(): void {
  thump({ duration: 0.12, volume: 0.6, from: 260, to: 90 });
  ring(740, 0.4, 0.15);
  noiseBurst({ duration: 0.25, volume: 0.4, filter: 'bandpass', frequency: 2500, q: 3 });
}

/** The chain comes back: a rattle of links getting quieter. */
export function playSmithHookEnd(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  for (let i = 0; i < 6; i++) {
    noiseBurst({ out, start: i * 0.05, duration: 0.02, volume: 0.3 - i * 0.04, filter: 'highpass', frequency: 4000 });
  }
}

/** The Damned Smith joins the wave: an anvil struck three times, slow and low, far away. Not positional: an announcement. */
export function playSmithArrived(): void {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => ring(220, 2, 0.25), i * 550);
    thump({ start: i * 0.55, duration: 0.15, volume: 0.5, from: 120, to: 50 });
  }
}

/**
 * A drink poured at the saloon (drinks.ts): the glass set down on the
 * counter (a dull knock), the whiskey glugging in (a few bubbles: short
 * band-passed noise bursts rising in pitch), a clink, and a low "hah" of the
 * burn going down (filtered noise falling). A pact should sound like one.
 */
export function playDrink(): void {
  thump({ duration: 0.08, volume: 0.5, from: 220, to: 120 });
  for (let i = 0; i < 6; i++) {
    noiseBurst({ start: 0.12 + i * 0.07, duration: 0.05, volume: 0.25, filter: 'bandpass', frequency: 500 + i * 90, q: 6 });
  }
  setTimeout(() => ring(2600, 0.5, 0.08), 600);
  noiseBurst({ start: 0.9, duration: 0.5, volume: 0.22, filter: 'lowpass', frequency: 1400, frequencyEnd: 300 });
  thump({ start: 0.9, duration: 0.4, volume: 0.25, from: 70, to: 40 });
}

/**
 * A map event shows up (mapEvents.ts): a dinner triangle beaten fast, the
 * saloon calling you, over a low drum of the devil's game. High and quick on
 * purpose: the church bell (waves) is low and slow, the anvil (Smith) is
 * metallic and heavy; three announcements, three sounds you can't confuse.
 */
export function playMapEventStart(): void {
  // The triangle: ring() is the same inharmonic metal of the bells, just high and short.
  for (let i = 0; i < 6; i++) setTimeout(() => ring(1250 + (i % 2) * 40, 0.9, 0.12), i * 110);
  // Two low drum hits under it, and a third one after the triangle stops.
  for (const at of [0, 0.22, 0.75]) thump({ start: at, duration: 0.3, volume: 0.45, from: 90, to: 45 });
}

/**
 * A bell of the "Campane del Giudizio" rang, where it hangs. Each one is
 * higher than the one before (a rising major chord: 1, 5/4, 3/2), so you hear
 * your progress; the last one rings longer, with a low thump of the clapper.
 * Positional but loud: you should hear a bell across the town.
 */
export function playEventBell(where: Where, index: number, last: boolean): void {
  const out = placeSound({ volume: Math.max(0.35, where.volume), pan: where.pan });
  if (!out) return;
  const base = 330 * [1, 1.25, 1.5, 2][Math.min(index, 3)];
  ring(base, last ? 4.5 : 3, 0.4, out);
  thump({ out, duration: 0.18, volume: 0.5, from: base, to: base / 2 });
}

/**
 * Pony Express: you ran through a ring of fire. A WHOOSH (noise through a
 * band-pass whose frequency sweeps up: the fire rushing past your ears) and a
 * short chime that climbs a step of the pentatonic scale at each ring
 * (semitones 0, 2, 4, 7, 9, then the next octave): you hear the race
 * progress. The last ring: the chime plus two more notes on top, a fanfare.
 */
export function playRingPassed(where: Where, index: number, last: boolean): void {
  const out = placeSound({ volume: Math.max(0.5, where.volume), pan: where.pan });
  if (!out) return;
  noiseBurst({ out, duration: 0.28, volume: 0.6, filter: 'bandpass', frequency: 350, frequencyEnd: 2600, q: 1.5 });
  const steps = [0, 2, 4, 7, 9];
  const semitones = steps[index % steps.length] + 12 * Math.floor(index / steps.length);
  const base = 392 * 2 ** (semitones / 12);
  ring(base, 0.7, 0.22, out);
  if (last) {
    setTimeout(() => ring(base * 1.25, 0.9, 0.2, out), 110);
    setTimeout(() => ring(base * 1.5, 1.6, 0.22, out), 220);
  }
}

/**
 * "Il Cuore di Brace" wakes up (you touched it): a big WHOOMPH of fire (noise
 * through a band-pass sweeping UP: the flames rushing out), a deep boom, the
 * first heavy heartbeat (lub-dub) and a low ring that hangs in the air like a
 * drone. Positional, but loud: it's the start of something.
 */
export function playEmberHeartWake(where: Where): void {
  const out = placeSound({ volume: Math.max(0.6, where.volume), pan: where.pan });
  if (!out) return;
  noiseBurst({ out, duration: 0.8, volume: 0.8, filter: 'bandpass', frequency: 180, frequencyEnd: 1800, q: 1.1 });
  thump({ out, duration: 1.3, volume: 0.9, from: 80, to: 26 });
  thump({ out, start: 0.45, duration: 0.25, volume: 0.7, from: 70, to: 34 });
  thump({ out, start: 0.66, duration: 0.25, volume: 0.5, from: 62, to: 30 });
  ring(98, 3.5, 0.18, out);
}

/**
 * One beat of the Ember Heart: a muffled lub-dub (two low thumps) with a few
 * embers popping on top (tiny clicks of high noise), so it doesn't sound
 * like YOUR heartbeat at low health (a single soft thump, playHeartbeat).
 * `strength` 0..1: it beats harder as it fills up.
 */
export function playEmberHeartBeat(where: Where, strength: number): void {
  const out = placeSound({ volume: where.volume * (0.5 + 0.5 * strength), pan: where.pan });
  if (!out) return;
  thump({ out, duration: 0.2, volume: 0.55, from: 66, to: 34 });
  thump({ out, start: 0.19, duration: 0.2, volume: 0.38, from: 58, to: 30 });
  for (let i = 0; i < 3; i++) {
    noiseBurst({ out, start: 0.02 + Math.random() * 0.3, duration: 0.012, volume: 0.18, filter: 'highpass', frequency: 3500 });
  }
}

/**
 * A soul reached the Ember Heart: a SUCK (noise whose band-pass sweeps DOWN
 * while it gets louder: the reverse of a whoosh, something pulled in), a
 * gulp (a short low thump) and a chime that climbs with how full the heart
 * is (`fill` 0..1: two octaves of the pentatonic scale), so you hear it fill.
 */
export function playEmberHeartFeed(where: Where, fill: number): void {
  const out = placeSound({ volume: Math.max(0.35, where.volume), pan: where.pan });
  if (!out || !ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(2600, t0);
  filter.frequency.exponentialRampToValueAtTime(260, t0 + 0.22);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.02, t0);
  gain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.2); // getting louder: it's coming IN
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
  src.connect(filter).connect(gain).connect(out);
  src.start(t0, Math.random() * 0.5, 0.3);
  thump({ out, start: 0.2, duration: 0.18, volume: 0.6, from: 110, to: 45 });
  const steps = [0, 3, 5, 7, 10]; // minor pentatonic: darker than the Pony Express's
  const step = Math.min(9, Math.floor(fill * 10));
  const semitones = steps[step % 5] + 12 * Math.floor(step / 5);
  setTimeout(() => ring(220 * 2 ** (semitones / 12), 0.8, 0.14, out), 200);
}

/**
 * The Ember Heart is full and bursts: a huge boom, the crystal shattering
 * (a spray of short high clicks and a high inharmonic ring: glass and metal)
 * and the fire roaring out.
 */
export function playEmberHeartBurst(where: Where): void {
  const out = placeSound({ volume: Math.max(0.7, where.volume), pan: where.pan });
  if (!out) return;
  thump({ out, duration: 1.6, volume: 1, from: 95, to: 24 });
  noiseBurst({ out, duration: 1.2, volume: 0.7, filter: 'lowpass', frequency: 2200, frequencyEnd: 150 });
  for (let i = 0; i < 16; i++) {
    noiseBurst({ out, start: i * 0.018 + Math.random() * 0.03, duration: 0.03, volume: 0.25, filter: 'bandpass', frequency: 4000 + Math.random() * 3000, q: 6 });
  }
  ring(1450, 1.6, 0.16, out);
  ring(620, 2.4, 0.14, out);
}

/**
 * The Ember Heart dies (the wave ended before it was full): a long falling
 * hiss (embers going out: noise through a low-pass that closes), a dying
 * thump, and a dull crack of the crystal.
 */
export function playEmberHeartDie(where: Where): void {
  const out = placeSound({ volume: Math.max(0.4, where.volume), pan: where.pan });
  if (!out) return;
  noiseBurst({ out, duration: 1.6, volume: 0.45, filter: 'lowpass', frequency: 3000, frequencyEnd: 180 });
  thump({ out, duration: 0.9, volume: 0.6, from: 55, to: 22 });
  noiseBurst({ out, start: 0.3, duration: 0.06, volume: 0.4, filter: 'bandpass', frequency: 900, q: 3 });
}

/**
 * A GHOST'S VOICE: a pure tone (a sine: no harmonics, nothing "throaty")
 * that slides from `from` to `to` Hz with a slow VIBRATO (an LFO, a second
 * oscillator at a few Hz wobbling the pitch, like playShovelBonk's DOIIING)
 * and swells in and out softly (no hard attack: it doesn't strike, it
 * appears). The building block of the Soul Well's sounds.
 */
function ghostVoice(out: AudioNode, start: number, from: number, to: number, duration: number, volume: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 4.5 + Math.random() * 1.5;
  const depth = ctx.createGain();
  depth.gain.value = from * 0.015; // ±1.5% of the pitch
  lfo.connect(depth).connect(osc.frequency);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + duration * 0.3);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(out);
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + duration);
  lfo.stop(t0 + duration);
}

/** A rising major pentatonic (semitones): the Soul Well's notes climb it, like the Pony Express rings. */
const SOUL_STEPS = [0, 2, 4, 7, 9];
function soulNote(base: number, step: number): number {
  return base * 2 ** ((SOUL_STEPS[step % 5] + 12 * Math.floor(step / 5)) / 12);
}

/**
 * The Soul Well wakes up (you walked to it): wind howling up out of the
 * shaft (noise through a band-pass sweeping up and down: the well
 * "breathing"), a deep hollow boom from far below, and a choir of ghosts
 * fading in on a minor chord (three ghost voices) that hangs in the air.
 */
export function playSoulWellWake(where: Where): void {
  const out = placeSound({ volume: Math.max(0.6, where.volume), pan: where.pan });
  if (!out) return;
  noiseBurst({ out, duration: 1.4, volume: 0.45, filter: 'bandpass', frequency: 220, frequencyEnd: 1400, q: 3 });
  noiseBurst({ out, start: 0.7, duration: 1.4, volume: 0.3, filter: 'bandpass', frequency: 1400, frequencyEnd: 300, q: 3 });
  thump({ out, duration: 1.8, volume: 0.8, from: 70, to: 24 });
  ghostVoice(out, 0.2, 220, 220, 2.6, 0.14);
  ghostVoice(out, 0.35, 262, 262, 2.4, 0.1); // a minor third over it
  ghostVoice(out, 0.5, 330, 311, 2.2, 0.09); // the fifth, sagging a little: something's wrong
}

/**
 * You caught a soul: a short breath IN (noise whose band-pass sweeps up,
 * getting louder: it comes to you), a glassy chime and a tiny ghost voice,
 * pitched up the pentatonic with how many souls you carry: you HEAR your
 * hands filling. Not positional: it's in your hands.
 */
export function playSoulCollect(carried: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 3;
  filter.frequency.setValueAtTime(500, t0);
  filter.frequency.exponentialRampToValueAtTime(3000, t0 + 0.16);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.01, t0);
  gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.14);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  src.connect(filter).connect(gain).connect(world);
  src.start(t0, Math.random() * 0.5, 0.22);
  const note = soulNote(523, Math.min(14, Math.max(0, carried - 1)));
  setTimeout(() => ring(note * 2, 0.5, 0.05), 120);
  ghostVoice(world, 0.1, note, note * 1.02, 0.5, 0.08);
}

/**
 * A soul on the ground went out before you got there: a little sigh, a
 * ghost voice sliding down and away. Quiet, positional: you hear the ones
 * you're losing around you.
 */
export function playSoulFaded(where: Where): void {
  const out = placeSound({ volume: where.volume * 0.5, pan: where.pan });
  if (!out) return;
  ghostVoice(out, 0, 700, 260, 0.6, 0.12);
  noiseBurst({ out, duration: 0.4, volume: 0.06, filter: 'bandpass', frequency: 1800, frequencyEnd: 500, q: 2 });
}

/**
 * Souls dropped into the well: one falling whoosh for each soul (a few at
 * most), each going DOWN (noise and a ghost voice sliding down: into the
 * shaft), then a hollow splash from far below and a bright chime that climbs
 * with how full the well is (`fill` 0..1), with an echo of itself.
 */
export function playSoulsDeposited(where: Where, souls: number, fill: number): void {
  const out = placeSound({ volume: Math.max(0.5, where.volume), pan: where.pan });
  if (!out) return;
  const n = Math.min(6, souls);
  for (let i = 0; i < n; i++) {
    noiseBurst({ out, start: i * 0.07, duration: 0.35, volume: 0.2, filter: 'bandpass', frequency: 2400, frequencyEnd: 200, q: 2 });
    ghostVoice(out, i * 0.07, 880 - i * 40, 180, 0.45, 0.06);
  }
  const land = n * 0.07 + 0.3;
  thump({ out, start: land, duration: 0.6, volume: 0.55, from: 120, to: 40 });
  noiseBurst({ out, start: land, duration: 0.5, volume: 0.25, filter: 'lowpass', frequency: 1600, frequencyEnd: 200 });
  const note = soulNote(330, Math.min(9, Math.floor(fill * 10)));
  setTimeout(() => ring(note, 1.4, 0.16, out), land * 1000);
  setTimeout(() => ring(note, 1.0, 0.06, out), (land + 0.3) * 1000); // the echo down the shaft
}

/**
 * The well is full: a deep boom, the GEYSER of souls roaring up out of it
 * (noise through a low-pass that OPENS: the opposite of a dying fire), and
 * the ghost choir again, this time on a MAJOR chord that climbs: freed.
 */
export function playSoulWellFull(where: Where): void {
  const out = placeSound({ volume: Math.max(0.7, where.volume), pan: where.pan });
  if (!out) return;
  thump({ out, duration: 1.6, volume: 1, from: 90, to: 24 });
  noiseBurst({ out, duration: 1.8, volume: 0.6, filter: 'lowpass', frequency: 300, frequencyEnd: 5000 });
  [262, 330, 392, 523].forEach((f, i) => ghostVoice(out, 0.15 + i * 0.12, f, f * 1.5, 2.6, 0.12));
  setTimeout(() => ring(1046, 2.2, 0.14, out), 400);
}

/**
 * The well dies (the wave ended before it was full): a long moan falling
 * into the dark (a ghost voice sliding down an octave and more), the wind
 * in the shaft dying out.
 */
export function playSoulWellDie(where: Where): void {
  const out = placeSound({ volume: Math.max(0.4, where.volume), pan: where.pan });
  if (!out) return;
  ghostVoice(out, 0, 330, 90, 2.2, 0.16);
  ghostVoice(out, 0.15, 392, 110, 2.0, 0.08);
  noiseBurst({ out, duration: 2, volume: 0.3, filter: 'bandpass', frequency: 900, frequencyEnd: 120, q: 2 });
  thump({ out, start: 0.4, duration: 1, volume: 0.45, from: 50, to: 22 });
}

// --- "Spettacolo Cruento" (render/sermon.ts): the preacher and his organ ---

/**
 * A CHURCH ORGAN chord: for every note, a few sine "pipes" at the note and
 * its octaves (1, 2, 4 × the pitch, plus a quiet fifth above: the organ's
 * DRAWBARS, each one a row of pipes you pull in), through a low-pass so it
 * sounds like wood and air rather than a synth. Slow swell in, slow fade out:
 * organ pipes don't strike, they breathe. A slight detune per pipe makes the
 * chord shimmer like a real room full of pipes.
 */
function organChord(out: AudioNode, start: number, notes: number[], duration: number, volume: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + Math.min(0.25, duration * 0.3));
  gain.gain.setValueAtTime(volume, t0 + duration * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  filter.connect(gain).connect(out);
  for (const note of notes) {
    for (const [ratio, level] of [[1, 1], [2, 0.6], [3, 0.25], [4, 0.3]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = note * ratio * (1 + (Math.random() - 0.5) * 0.004);
      const pipe = ctx.createGain();
      pipe.gain.value = level / notes.length;
      osc.connect(pipe).connect(filter);
      osc.start(t0);
      osc.stop(t0 + duration);
    }
  }
}

/**
 * The preacher's VOICE: one shouted syllable. Like the devil's laugh (devilLaugh
 * below), a buzz (sawtooth) shaped by the throat, but with TWO formants, the
 * two resonances that tell vowels apart: "a" ≈ 750 + 1200 Hz, "e" ≈ 500 + 1900 Hz,
 * "o" ≈ 450 + 850 Hz, "u" ≈ 330 + 800 Hz. Moving them while the voice sounds
 * glides from one vowel to the next ("a-men"). The pitch falls at the end of
 * the syllable, like someone shouting from a pulpit.
 */
const VOWELS = { a: [750, 1200], e: [500, 1900], o: [450, 850], u: [330, 800], i: [300, 2300] } as const;
type Vowel = keyof typeof VOWELS;
function preacherSyllable(out: AudioNode, start: number, pitch: number, duration: number, from: Vowel, to: Vowel, volume: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(pitch * 1.06, t0);
  osc.frequency.linearRampToValueAtTime(pitch, t0 + duration * 0.3);
  osc.frequency.exponentialRampToValueAtTime(pitch * 0.82, t0 + duration);
  // A little vibrato: a voice holding a note is never perfectly still.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const depth = ctx.createGain();
  depth.gain.value = pitch * 0.02;
  lfo.connect(depth).connect(osc.frequency);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.04);
  gain.gain.setValueAtTime(volume, t0 + duration * 0.75);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  gain.connect(out);
  for (let k = 0; k < 2; k++) {
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.Q.value = 5;
    formant.frequency.setValueAtTime(VOWELS[from][k], t0);
    formant.frequency.linearRampToValueAtTime(VOWELS[to][k], t0 + duration * 0.5);
    const level = ctx.createGain();
    level.gain.value = k === 0 ? 1 : 0.6;
    osc.connect(formant).connect(level).connect(gain);
  }
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + duration);
  lfo.stop(t0 + duration);
}

/** A big church bell far away: the low ring of ring(), longer. */
function churchBell(out: AudioNode, start: number, pitch: number, volume: number): void {
  setTimeout(() => ring(pitch, 3.5, volume, out), start * 1000);
}

/**
 * The preacher wakes up (you walked to him): he slams his book shut (a dry
 * thump and the slap of the cover), the church bell tolls, the organ swells
 * on a dark minor chord and he shouts "BRE-THREN!" (two syllables, falling).
 */
export function playSermonWake(where: Where): void {
  const out = placeSound({ volume: Math.max(0.6, where.volume), pan: where.pan });
  if (!out) return;
  thump({ out, duration: 0.18, volume: 0.7, from: 140, to: 60 });
  noiseBurst({ out, duration: 0.08, volume: 0.4, filter: 'bandpass', frequency: 1600, q: 2 });
  churchBell(out, 0.1, 110, 0.3);
  organChord(out, 0.2, [110, 131, 165], 2.6, 0.35); // A minor, low
  preacherSyllable(out, 0.45, 150, 0.32, 'e', 'e', 0.35);
  preacherSyllable(out, 0.8, 135, 0.6, 'e', 'e', 0.4);
}

/**
 * The show goes up a rank under his eyes: "A-MEN!", higher at every rank
 * (`rank` 1..5: he gets more and more excited), with an organ stab on a
 * major chord climbing with it.
 */
export function playSermonAmen(where: Where, rank: number): void {
  const out = placeSound({ volume: Math.max(0.45, where.volume), pan: where.pan });
  if (!out) return;
  const pitch = 130 * 2 ** (rank * 2 / 12); // a whole tone higher at every rank
  preacherSyllable(out, 0, pitch, 0.18, 'a', 'a', 0.35);
  preacherSyllable(out, 0.2, pitch * 1.12, 0.5, 'e', 'e', 0.4);
  const root = 196 * 2 ** (rank * 2 / 12);
  organChord(out, 0.05, [root, root * 1.26, root * 1.5], 0.9, 0.22);
}

/**
 * HIGH NOON outside his circle: he didn't see it. A disappointed "tsk" (a
 * short click of high noise), the organ on a sour chord (two notes a
 * semitone apart: a minor second, the most "wrong" interval) and a grumbled
 * "noo" falling.
 */
export function playSermonMissed(where: Where): void {
  const out = placeSound({ volume: Math.max(0.4, where.volume), pan: where.pan });
  if (!out) return;
  noiseBurst({ out, duration: 0.03, volume: 0.3, filter: 'highpass', frequency: 4000 });
  noiseBurst({ out, start: 0.12, duration: 0.03, volume: 0.25, filter: 'highpass', frequency: 4000 });
  organChord(out, 0.2, [98, 104], 1.2, 0.3);
  preacherSyllable(out, 0.3, 120, 0.7, 'o', 'u', 0.3);
}

/**
 * GLORY: HIGH NOON inside his circle, the show is over and it was good.
 * "HAL-LE-LU-JAH!" over the full organ on a major chord climbing an octave,
 * the church bells ringing, and then the roar of fire (noise opening up: he
 * goes up in flames, in ecstasy).
 */
export function playSermonGlory(where: Where): void {
  const out = placeSound({ volume: Math.max(0.7, where.volume), pan: where.pan });
  if (!out) return;
  organChord(out, 0, [131, 165, 196, 262], 1.2, 0.4); // C major
  organChord(out, 1.0, [175, 220, 262, 349], 1.0, 0.4); // F major
  organChord(out, 1.8, [196, 247, 294, 392, 523], 2.4, 0.45); // G major, the top: the "amen" cadence goes home
  const syllables: [number, Vowel, Vowel, number][] = [
    [0.1, 'a', 'a', 165],
    [0.4, 'e', 'e', 175],
    [0.7, 'u', 'u', 196],
    [1.0, 'a', 'a', 262],
  ];
  for (const [at, from, to, pitch] of syllables) preacherSyllable(out, at, pitch, at === 1.0 ? 0.9 : 0.28, from, to, 0.4);
  churchBell(out, 0.0, 220, 0.25);
  churchBell(out, 0.6, 330, 0.2);
  churchBell(out, 1.2, 440, 0.18);
  noiseBurst({ out, start: 1.9, duration: 1.6, volume: 0.5, filter: 'lowpass', frequency: 300, frequencyEnd: 4000 });
  thump({ out, start: 1.9, duration: 1.0, volume: 0.7, from: 90, to: 30 });
}

/**
 * The wave ended without a show: he slams the book (a heavy thump), the
 * organ slides down into a dissonant low chord and dies, and a long
 * disgusted groan.
 */
export function playSermonFail(where: Where): void {
  const out = placeSound({ volume: Math.max(0.4, where.volume), pan: where.pan });
  if (!out) return;
  thump({ out, duration: 0.25, volume: 0.6, from: 120, to: 45 });
  organChord(out, 0.1, [110, 117, 147], 1.0, 0.3);
  organChord(out, 0.9, [55, 58, 73], 2.0, 0.35);
  preacherSyllable(out, 0.4, 110, 1.2, 'u', 'o', 0.3);
  noiseBurst({ out, start: 0.8, duration: 1.4, volume: 0.25, filter: 'lowpass', frequency: 800, frequencyEnd: 150 });
}

/**
 * The devil's laugh: three "HA"s, each lower than the one before. A voice
 * is a buzz (sawtooth, full of harmonics) shaped by the throat: a band-pass
 * at ~700 Hz (a FORMANT, the resonance that makes an "a" sound like an "a").
 * Low and slow, slightly detuned: not a person laughing.
 */
function devilLaugh(start: number, out: AudioNode): void {
  if (!ctx) return;
  [0, 0.26, 0.52].forEach((at, i) => {
    const t0 = ctx!.currentTime + start + at;
    const pitch = 92 - i * 9;
    const osc = ctx!.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(pitch * 1.15, t0);
    osc.frequency.exponentialRampToValueAtTime(pitch, t0 + 0.2);
    const formant = ctx!.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 700;
    formant.Q.value = 2.5;
    const gain = ctx!.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.connect(formant).connect(gain).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.25);
    noiseBurst({ out, start: start + at, duration: 0.12, volume: 0.12, filter: 'bandpass', frequency: 1200, q: 2 }); // the breath of the "h"
  });
}

/**
 * The devil's wager taken, at the table: the deck riffled (a quick run of
 * clicks of high noise), a stack of chips pushed in (lower clacks), a thump on
 * the felt, and the devil laughing. Positional: you're right there anyway.
 */
export function playWagerAccepted(where: Where): void {
  const out = placeSound({ volume: Math.max(0.6, where.volume), pan: where.pan });
  if (!out) return;
  for (let i = 0; i < 14; i++) {
    noiseBurst({ out, start: i * 0.022, duration: 0.02, volume: 0.25, filter: 'bandpass', frequency: 4200, q: 3 });
  }
  for (let i = 0; i < 5; i++) {
    noiseBurst({ out, start: 0.38 + i * 0.05, duration: 0.03, volume: 0.3, filter: 'bandpass', frequency: 2600, q: 5 });
  }
  thump({ out, start: 0.65, duration: 0.2, volume: 0.6, from: 120, to: 50 });
  devilLaugh(0.8, out);
}

/**
 * The cursed wave starts: a huge low gong (a ring at 70 Hz, long), a swell of
 * dark noise rising under it, and a touch of the curse itself: a clock
 * ticking too fast (faster enemies), the revolver's hammer cocked (one gun),
 * a bottle breaking (no medkits), a cold wind (darkness).
 */
export function playWagerCurse(curse: 'noMedkits' | 'oneGun' | 'fastEnemies' | 'darkness'): void {
  ring(70, 5, 0.5);
  thump({ duration: 1.2, volume: 0.7, from: 60, to: 30 });
  noiseBurst({ duration: 1.6, volume: 0.25, filter: 'lowpass', frequency: 150, frequencyEnd: 900 });
  if (curse === 'fastEnemies') {
    for (let i = 0; i < 12; i++) {
      noiseBurst({ start: 0.6 + i * (0.12 - i * 0.005), duration: 0.015, volume: 0.35, filter: 'bandpass', frequency: i % 2 ? 3000 : 2400, q: 8 });
    }
  } else if (curse === 'oneGun') {
    noiseBurst({ start: 0.7, duration: 0.03, volume: 0.5, filter: 'bandpass', frequency: 2000, q: 4 });
    noiseBurst({ start: 0.82, duration: 0.04, volume: 0.6, filter: 'bandpass', frequency: 1500, q: 4 });
  } else if (curse === 'noMedkits') {
    setTimeout(() => ring(2400, 0.6, 0.12), 650);
    noiseBurst({ start: 0.65, duration: 0.4, volume: 0.35, filter: 'highpass', frequency: 3000 });
  } else {
    noiseBurst({ start: 0.4, duration: 2.5, volume: 0.25, filter: 'bandpass', frequency: 500, frequencyEnd: 250, q: 3 });
  }
}

/**
 * The devil's table sinks into the ground in a burst of hellfire: a whoosh
 * of fire (noise through a band-pass that sweeps down: it's going away) and
 * a low rumble. Positional.
 */
export function playWagerVanish(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.9, volume: 0.6, filter: 'bandpass', frequency: 1800, frequencyEnd: 200, q: 1.2 });
  thump({ out, duration: 0.8, volume: 0.6, from: 70, to: 30 });
}

/**
 * The event is over. Success: three rising rings (a major arpeggio: 1, 5/4,
 * 3/2 of the base) and a rattle of chips on the counter (short clicks of
 * high noise). Failure: one low ring that drops a semitone, and nothing else.
 */
export function playMapEventEnd(success: boolean): void {
  if (success) {
    [1, 1.25, 1.5].forEach((ratio, i) => setTimeout(() => ring(520 * ratio, 1.4, 0.16), i * 140));
    for (let i = 0; i < 7; i++) {
      noiseBurst({ start: 0.45 + i * 0.045 + Math.random() * 0.02, duration: 0.03, volume: 0.3, filter: 'bandpass', frequency: 3500, q: 4 });
    }
  } else {
    ring(196, 2.2, 0.2);
    setTimeout(() => ring(185, 2.5, 0.16), 450); // a semitone down (×0.944): it "sags"
  }
}

/**
 * Drink "Ali del corvo": the jump in mid-air. A heavy wingbeat (a low
 * "whump" of filtered noise, twice, the second softer: the wing going down
 * and back) and a far-off caw (a short sawtooth that drops, through a band-pass).
 */
export function playAirJump(): void {
  noiseBurst({ duration: 0.16, volume: 0.55, filter: 'lowpass', frequency: 700, frequencyEnd: 200 });
  noiseBurst({ start: 0.12, duration: 0.12, volume: 0.3, filter: 'lowpass', frequency: 600, frequencyEnd: 200 });
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(950, t0);
  osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.22);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1300;
  band.Q.value = 3;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  osc.connect(band).connect(gain).connect(world);
  osc.start(t0);
  osc.stop(t0 + 0.26);
}

/**
 * Drink "Zoccolo del diavolo": a hard landing that shakes the ground. A huge
 * hoof on stone: a deep thump, a sharp crack, and a rumble that rolls away.
 */
export function playHoofSlam(): void {
  thump({ duration: 0.5, volume: 1.3, from: 110, to: 30 });
  noiseBurst({ duration: 0.08, volume: 0.8, filter: 'highpass', frequency: 1800 });
  ring(180, 0.6, 0.12); // the iron shoe
  noiseBurst({ start: 0.04, duration: 0.8, volume: 0.6, filter: 'lowpass', frequency: 500, frequencyEnd: 70 });
}

/**
 * Drink "Bobby": an enemy projectile batted back. A bright metal "TING" (the
 * boot's iron toe) with a quick swish of the shot leaving faster.
 */
export function playBatted(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  ring(1500, 0.5, 0.3, out);
  noiseBurst({ out, duration: 0.18, volume: 0.4, filter: 'bandpass', frequency: 2500, frequencyEnd: 900, q: 2 });
}

/**
 * Drink "Ultimo respiro": death said no. A huge heartbeat (two thumps) and a
 * low church bell under it, and a gasp of air (noise rising).
 */
export function playLastBreath(): void {
  thump({ duration: 0.25, volume: 1.4, from: 70, to: 35 });
  thump({ start: 0.28, duration: 0.3, volume: 1.1, from: 65, to: 30 });
  ring(98, 3, 0.35);
  noiseBurst({ start: 0.5, duration: 0.6, volume: 0.25, filter: 'bandpass', frequency: 600, frequencyEnd: 1800, q: 1 });
}

/**
 * Drink "Tequila del torero": a risky dodge healed you. A quick flamenco
 * strum: the notes of a chord (E, G#, B, E: the Phrygian flavor of a Spanish
 * guitar) plucked one after the other, each a short triangle wave dying fast.
 */
export function playTequila(): void {
  if (!ctx) return;
  [165, 208, 247, 330, 415].forEach((freq, i) => {
    const t0 = ctx!.currentTime + i * 0.025;
    const osc = ctx!.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx!.createGain();
    gain.gain.setValueAtTime(0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    osc.connect(gain).connect(world);
    osc.start(t0);
    osc.stop(t0 + 0.62);
  });
  noiseBurst({ duration: 0.05, volume: 0.15, filter: 'highpass', frequency: 3000 }); // the nails on the strings
}

/**
 * Drink "Contratto del becchino": the contract paid. A pen scratching the
 * ledger (a band of noise sliding) and a low bell: one more line signed.
 */
export function playContract(): void {
  noiseBurst({ duration: 0.25, volume: 0.25, filter: 'bandpass', frequency: 3500, frequencyEnd: 2000, q: 3 });
  setTimeout(() => ring(147, 2, 0.25), 200);
}

/**
 * Drink "Sperone d'argento": a wall jump loaded a round. The spur's rowel
 * jingling (three tiny high rings) and the click of the round going in.
 */
export function playSpur(): void {
  for (let i = 0; i < 3; i++) setTimeout(() => ring(3200 + i * 260, 0.25, 0.05), i * 35);
  noiseBurst({ start: 0.08, duration: 0.03, volume: 0.35, filter: 'highpass', frequency: 2200 });
  thump({ start: 0.08, duration: 0.04, volume: 0.25, from: 600, to: 300 });
}

/** The Damned Smith falls: a huge clatter of armor and a last low groan. */
export function playSmithDeath(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  playGroan(where, 0.5);
  thump({ out, start: 0.15, duration: 0.5, volume: 1.2, from: 100, to: 30 });
  for (let i = 0; i < 5; i++) {
    noiseBurst({ out, start: 0.1 + i * 0.07, duration: 0.08, volume: 0.5, filter: 'bandpass', frequency: 2500 + i * 300, q: 6 });
  }
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
export function playShovelBonk(hits: number, power = 1): void {
  if (!ctx) return;
  // power > 1 (card "Slancio"): every step lowers the pitch a bit (a bigger, heavier bell) and adds a deep crunch.
  const v = (0.92 + Math.random() * 0.16) * Math.pow(0.88, power - 1);
  const loud = Math.min(1, 0.75 + hits * 0.1);
  thump({ duration: 0.2, volume: 0.9 * loud, from: 140 * v, to: 45 });
  if (power > 1) thump({ duration: 0.35, volume: Math.min(1, 0.4 + 0.2 * power), from: 90, to: 28 });
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

/**
 * A dynamite stick blows up: the biggest sound in the game, in layers (like
 * every explosion in film sound design):
 * - the CRACK: a very short burst of high noise, the shock front;
 * - the BOOM: a sine falling from 90 to 28 Hz over more than a second, the
 *   "chest" of the blast (you feel it more than you hear it);
 * - the ROAR: noise through a low-pass filter that closes from 2.5 kHz to
 *   80 Hz, the fire and the air rushing out;
 * - the RUMBLE: a long, very low tail, the echo off the buildings;
 * - the DEBRIS: little clatters falling back down, at random moments.
 * `where` is the usual position (volume and panning); a blast is loud, so
 * it gets a boost and stays audible from far away.
 */
export function playDynamiteBlast(where: Where): void {
  const out = placeSound({ volume: Math.min(1, where.volume * 1.6), pan: where.pan * 0.7 });
  if (!out) return;
  noiseBurst({ out, duration: 0.09, volume: 0.9, filter: 'highpass', frequency: 2200 }); // crack
  thump({ out, duration: 1.4, volume: 1.3, from: 90, to: 28 }); // boom
  thump({ out, duration: 0.25, volume: 0.6, from: 220, to: 60 }); // punch
  noiseBurst({ out, duration: 1.6, volume: 1.0, filter: 'lowpass', frequency: 2500, frequencyEnd: 80 }); // roar
  noiseBurst({ out, start: 0.12, duration: 2.6, volume: 0.45, filter: 'lowpass', frequency: 260, frequencyEnd: 40 }); // rumble
  for (let i = 0; i < 7; i++) {
    // Debris: small, bright "tk" sounds, scattered in time.
    const start = 0.35 + Math.random() * 1.1;
    noiseBurst({ out, start, duration: 0.05, volume: 0.12 + Math.random() * 0.1, filter: 'bandpass', frequency: 1500 + Math.random() * 2000, q: 4 });
  }
}

/**
 * A stick hits the floor or a wall: a hollow wooden "tonk" (a cardboard
 * tube full of sawdust and nitroglycerin...). `strength` 0..1 = how hard.
 */
export function playDynamiteBounce(where: Where, strength: number): void {
  const s = Math.max(0.15, Math.min(1, strength));
  const out = placeSound({ volume: where.volume * s, pan: where.pan });
  if (!out) return;
  const pitch = 0.9 + Math.random() * 0.25; // every bounce a bit different
  thump({ out, duration: 0.09, volume: 0.7, from: 320 * pitch, to: 140 * pitch });
  noiseBurst({ out, duration: 0.05, volume: 0.4, filter: 'bandpass', frequency: 900 * pitch, q: 3 });
}

/** A sound that keeps playing until stopped, and follows something that moves. */
export interface LoopingSound {
  /** Where it is now (call every frame). */
  move(where: Where): void;
  stop(): void;
}

/**
 * The burning fuse: a continuous HISS (looped noise, band-passed high) that
 * crackles (its volume shaken by a fast, irregular wobble: two oscillators
 * at unrelated rates, 13 and 31 Hz, added to the gain). Unlike the one-shot
 * sounds it lives as long as the stick: `move` updates volume and panning
 * every frame (setTargetAtTime: a smooth glide, a jump would click), `stop`
 * fades it out when the stick blows up.
 */
export function playFuseHiss(where: Where): LoopingSound {
  if (!ctx) return { move: () => {}, stop: () => {} };
  const audio = ctx;
  const t0 = audio.currentTime;
  const src = audio.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 4200;
  filter.Q.value = 0.9;
  const crackle = audio.createGain();
  crackle.gain.value = 0.06;
  const wobbles: OscillatorNode[] = [];
  for (const [rate, depth] of [[13, 0.03], [31, 0.025]]) {
    const lfo = audio.createOscillator();
    lfo.type = 'square'; // on/off: it sputters instead of swelling
    lfo.frequency.value = rate;
    const amount = audio.createGain();
    amount.gain.value = depth;
    lfo.connect(amount).connect(crackle.gain);
    lfo.start(t0);
    wobbles.push(lfo);
  }
  const volume = audio.createGain();
  volume.gain.value = where.volume;
  const panner = audio.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, where.pan));
  src.connect(filter).connect(crackle).connect(volume).connect(panner).connect(world);
  src.start(t0, Math.random() * 0.5);
  let stopped = false;
  return {
    move(w) {
      if (stopped) return;
      const now = audio.currentTime;
      volume.gain.setTargetAtTime(w.volume, now, 0.03);
      panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, w.pan)), now, 0.03);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = audio.currentTime;
      volume.gain.setTargetAtTime(0, now, 0.02);
      src.stop(now + 0.15);
      for (const o of wobbles) o.stop(now + 0.15);
    },
  };
}

/**
 * The launcher fires a stick: not a bang but a deep hollow THOOMP (a
 * low sine falling fast, plus a puff of low noise: compressed air, the
 * steampunk part), then the drum turning to the next stick, timed on the
 * animation (`t`, from dynamiteView.ts): the ratchet's quick rattle while
 * the cage spins, and the heavy CLACK when it slams into the stop.
 */
export function playDynamiteLaunch(t: { turnAt: number; clackAt: number }): void {
  if (!ctx) return;
  thump({ duration: 0.22, volume: 0.9, from: 160, to: 45 });
  noiseBurst({ duration: 0.25, volume: 0.6, filter: 'lowpass', frequency: 900, frequencyEnd: 150 }); // the puff
  noiseBurst({ start: 0.02, duration: 0.18, volume: 0.25, filter: 'bandpass', frequency: 2500, frequencyEnd: 900, q: 1 }); // the stick whooshing out
  const spin = t.clackAt - t.turnAt;
  for (let i = 0; i < 4; i++) {
    // The ratchet's pawl clicking over the teeth, faster and faster (the cage accelerates).
    const at = t.turnAt + spin * Math.sqrt(i / 4);
    noiseBurst({ start: at, duration: 0.015, volume: 0.12, filter: 'bandpass', frequency: 3200, q: 8 });
  }
  noiseBurst({ start: t.clackAt, duration: 0.05, volume: 0.6, filter: 'bandpass', frequency: 1400, q: 5 }); // CLACK
  thump({ start: t.clackAt, duration: 0.09, volume: 0.45, from: 240, to: 90 }); // the weight of the brass cage
}

/**
 * The launcher's reload, piece by piece: each sound is played by the view
 * (render/weapons/dynamiteView.ts) at the moment its piece moves, so it's
 * always on the animation (the physics decides when, the sound follows).
 */
/** The drum swings out and BANGS against the crane's stop: iron on iron, and the cage rattling. */
export function playDrumOpen(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.05, volume: 0.55, filter: 'bandpass', frequency: 1300, q: 5 });
  thump({ duration: 0.08, volume: 0.35, from: 260, to: 110 });
  noiseBurst({ start: 0.04, duration: 0.12, volume: 0.12, filter: 'bandpass', frequency: 3000, q: 3 }); // the cage rattling
}

/** A stick shoved into its chamber: a soft cardboard THUD and the scrape of paper on brass. */
export function playStickIn(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.06, volume: 0.2, filter: 'bandpass', frequency: 2400, frequencyEnd: 900, q: 2 }); // the scrape
  thump({ start: 0.04, duration: 0.07, volume: 0.4, from: 230, to: 100 });
}

/** The drum slammed shut and latched: the heaviest CLACK of the gun. */
export function playDrumShut(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.06, volume: 0.75, filter: 'bandpass', frequency: 1100, q: 4 });
  thump({ duration: 0.12, volume: 0.55, from: 200, to: 70 });
}

/** One chamber clicking past the pawl while the drum spins (`volume` 0..1: quieter as it slows). */
export function playDrumTick(volume: number): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.018, volume: 0.05 + 0.2 * Math.max(0, volume), filter: 'bandpass', frequency: 3200, q: 8 });
}

/**
 * An enemy catches the HOLY fire: a bright hiss, like water thrown on a hot
 * stove (high noise falling), and a pure high "ting", the holy touch.
 */
export function playHolyIgnite(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.35, volume: 0.45, filter: 'bandpass', frequency: 6000, frequencyEnd: 1800, q: 1.2 });
  ring(1320, 0.4, 0.05);
}

/**
 * A pool of holy fire burning: a soft, steady roar (low noise) under a
 * glassy shimmer (high noise, band-passed, shaken by two fast wobbles: the
 * crackle) and a faint pure hum, a choir-like fifth (two sines, 330 and 495
 * Hz): it burns, but it's holy. A LoopingSound, like the fuse's hiss:
 * `move` follows it (volume and panning), `stop` fades it out.
 */
export function playHolyFireLoop(where: Where): LoopingSound {
  if (!ctx) return { move: () => {}, stop: () => {} };
  const audio = ctx;
  const t0 = audio.currentTime;
  const volume = audio.createGain();
  volume.gain.setValueAtTime(0, t0);
  volume.gain.setTargetAtTime(where.volume, t0, 0.15); // it swells in
  const panner = audio.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, where.pan));
  volume.connect(panner).connect(world);
  const stops: (AudioScheduledSourceNode)[] = [];

  const noise = (type: BiquadFilterType, frequency: number, q: number, gain: number) => {
    const src = audio.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = audio.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const g = audio.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(volume);
    src.start(t0, Math.random() * 0.5);
    stops.push(src);
    return g;
  };
  noise('lowpass', 500, 0.7, 0.18); // the roar
  const shimmer = noise('bandpass', 5200, 1.5, 0.05); // the glassy crackle...
  for (const [rate, depth] of [[11, 0.03], [27, 0.02]]) {
    const lfo = audio.createOscillator(); // ...shaken
    lfo.type = 'square';
    lfo.frequency.value = rate;
    const amount = audio.createGain();
    amount.gain.value = depth;
    lfo.connect(amount).connect(shimmer.gain);
    lfo.start(t0);
    stops.push(lfo);
  }
  for (const f of [330, 495]) {
    const hum = audio.createOscillator();
    hum.frequency.value = f;
    const g = audio.createGain();
    g.gain.value = 0.012;
    hum.connect(g).connect(volume);
    hum.start(t0);
    stops.push(hum);
  }
  let stopped = false;
  return {
    move(w) {
      if (stopped) return;
      const now = audio.currentTime;
      volume.gain.setTargetAtTime(w.volume, now, 0.05);
      panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, w.pan)), now, 0.05);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = audio.currentTime;
      volume.gain.setTargetAtTime(0, now, 0.2); // it dies down
      for (const s of stops) s.stop(now + 1);
    },
  };
}

// --- Lo Sciacallo (src/sim/jackal.ts, src/render/enemies/jackals.ts) ---------------------

/**
 * The jackal's cackle: "hee-hee-hee-hee", the devil's laugh (devilLaugh)
 * turned into a little imp. Same recipe, a buzz through a throat, but HIGH
 * (pitch ~400 Hz instead of 90), quick (five syllables in half a second),
 * and the formant up at 1600 Hz: an "ee" instead of an "a". Each "hee"
 * slides up a bit at the start, and the whole laugh drifts down: mocking.
 */
function jackalCackle(out: AudioNode, start = 0): void {
  if (!ctx) return;
  const syllables = 4 + Math.floor(Math.random() * 3);
  const base = 380 + Math.random() * 70;
  for (let i = 0; i < syllables; i++) {
    const at = start + i * 0.105;
    const t0 = ctx.currentTime + at;
    const pitch = base * (1 - i * 0.035);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(pitch * 0.85, t0);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.08, t0 + 0.05);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 1600;
    formant.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.085);
    osc.connect(formant).connect(gain).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.1);
    noiseBurst({ out, start: at, duration: 0.04, volume: 0.08, filter: 'highpass', frequency: 3000 }); // the "h"
  }
}

/** The jackal laughs at you (taunting from afar, or now and then on the run). Positional: you follow it by ear. */
export function playJackalCackle(where: Where): void {
  const out = placeSound(where);
  if (out) jackalCackle(out);
}

/**
 * The sack jingling while it runs: two or three tiny coin ticks (very short
 * bursts of high noise through a narrow band-pass: metal on metal). Played
 * at every stride: a moving "ching-ching" you can track around a corner,
 * like the treasure goblins of Diablo.
 */
export function playJackalJingle(where: Where): void {
  const out = placeSound({ volume: where.volume * 0.6, pan: where.pan });
  if (!out) return;
  const ticks = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < ticks; i++) {
    noiseBurst({ out, start: i * 0.03 + Math.random() * 0.015, duration: 0.018, volume: 0.3, filter: 'bandpass', frequency: 5200 + Math.random() * 2000, q: 12 });
  }
}

/**
 * Hit: a yelp (one high "YIP", a pitch that jumps up and falls) and the
 * coins spilling out (a quick rattle and a couple of bright rings).
 */
export function playJackalHit(where: Where): void {
  const out = placeSound({ volume: Math.max(0.3, where.volume), pan: where.pan });
  if (!out || !ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(600, t0);
  osc.frequency.exponentialRampToValueAtTime(1100, t0 + 0.04);
  osc.frequency.exponentialRampToValueAtTime(450, t0 + 0.16);
  const formant = ctx.createBiquadFilter();
  formant.type = 'bandpass';
  formant.frequency.value = 1800;
  formant.Q.value = 2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
  osc.connect(formant).connect(gain).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.2);
  for (let i = 0; i < 6; i++) {
    noiseBurst({ out, start: 0.05 + i * 0.03 + Math.random() * 0.02, duration: 0.02, volume: 0.3, filter: 'bandpass', frequency: 4500 + Math.random() * 3000, q: 10 });
  }
  setTimeout(() => ring(2200, 0.25, 0.06, out), 80);
  setTimeout(() => ring(2900, 0.3, 0.05, out), 150);
}

/**
 * Killed: a long falling squeal, and the WHOLE sack bursting: a shower of
 * coins (many ticks over half a second) and a cash-register "ka-ching" on
 * top (the prize). Loud wherever you are: you got it.
 */
export function playJackalDeath(where: Where): void {
  const out = placeSound({ volume: Math.max(0.6, where.volume), pan: where.pan });
  if (!out || !ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(900, t0);
  osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.6);
  const formant = ctx.createBiquadFilter();
  formant.type = 'bandpass';
  formant.frequency.value = 1400;
  formant.Q.value = 2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
  osc.connect(formant).connect(gain).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.65);
  thump({ out, duration: 0.3, volume: 0.6, from: 140, to: 50 }); // the sack bursts
  for (let i = 0; i < 26; i++) {
    noiseBurst({ out, start: 0.05 + Math.random() * 0.6, duration: 0.02, volume: 0.28, filter: 'bandpass', frequency: 4000 + Math.random() * 4000, q: 10 });
  }
  setTimeout(() => ring(1760, 0.4, 0.1, out), 350);
  setTimeout(() => ring(2640, 0.8, 0.12, out), 420);
}

/**
 * It got away: a WHOOMPH of fire (noise through a band-pass sweeping up), a
 * last cackle, and a low thump as the ground closes over it.
 */
export function playJackalEscape(where: Where): void {
  const out = placeSound({ volume: Math.max(0.5, where.volume), pan: where.pan });
  if (!out) return;
  noiseBurst({ out, duration: 0.6, volume: 0.6, filter: 'bandpass', frequency: 200, frequencyEnd: 2400, q: 1.2 });
  thump({ out, start: 0.1, duration: 0.6, volume: 0.6, from: 90, to: 30 });
  jackalCackle(out, 0.15);
}

// --- La Taglia (src/sim/bounty.ts, src/render/bounty.ts) -------------------

/**
 * A whistled note that slides: a sine with a little VIBRATO (a slow
 * oscillator, an LFO, wobbling its pitch: the lips' tremble) and a breath of
 * noise on top. `from` → `to` Hz over `duration`.
 */
function whistle(start: number, duration: number, from: number, to: number, volume: number, out: AudioNode = world): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + duration * 0.6);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 6;
  const depth = ctx.createGain();
  depth.gain.value = to * 0.012;
  lfo.connect(depth).connect(osc.frequency);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.04);
  gain.gain.setValueAtTime(volume, t0 + duration * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(out);
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + duration);
  lfo.stop(t0 + duration);
  noiseBurst({ out, start, duration, volume: volume * 0.15, filter: 'bandpass', frequency: to * 2, q: 4 });
}

/**
 * The outlaw is in town (the poster went up a moment ago): a far-off shot
 * that echoes down the canyon, then the classic western whistle, a call and
 * its answer ("wa-wa-waaa", the second phrase lower), like the opening of an
 * old spaghetti western. Not positional: it's an announcement.
 */
export function playOutlawArrived(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.05, volume: 0.35, filter: 'highpass', frequency: 2200 });
  noiseBurst({ duration: 0.4, volume: 0.4, filter: 'lowpass', frequency: 1400, frequencyEnd: 150 });
  for (const at of [0.25, 0.55, 0.9]) noiseBurst({ start: at, duration: 0.45, volume: 0.12 / (1 + at), filter: 'lowpass', frequency: 700, frequencyEnd: 120 });
  whistle(0.7, 0.18, 880, 1175, 0.18);
  whistle(0.9, 0.18, 1175, 880, 0.18);
  whistle(1.1, 0.7, 880, 1320, 0.2);
  whistle(1.95, 0.18, 660, 784, 0.16);
  whistle(2.15, 0.18, 784, 660, 0.16);
  whistle(2.35, 0.9, 660, 587, 0.18);
}

/**
 * The shielded outlaw's shield breaks: glass and iron. A bright crash of
 * high noise, a scatter of tiny "tinks" (the shards), and a low "whump" of
 * the energy going out. Positional.
 */
export function playBountyShieldBreak(where: Where): void {
  const out = placeSound({ volume: Math.max(0.4, where.volume), pan: where.pan });
  if (!out) return;
  noiseBurst({ out, duration: 0.35, volume: 0.7, filter: 'highpass', frequency: 3000, frequencyEnd: 6000 });
  for (let i = 0; i < 8; i++) {
    noiseBurst({ out, start: 0.05 + i * 0.04 + Math.random() * 0.03, duration: 0.03, volume: 0.25, filter: 'bandpass', frequency: 5000 + Math.random() * 4000, q: 12 });
  }
  thump({ out, duration: 0.3, volume: 0.6, from: 220, to: 50 });
  ring(1400, 0.5, 0.12, out);
}

/** The shield is full again: a hum that rises (a sine sweeping up) and a soft chime on top. */
export function playBountyShieldUp(where: Where): void {
  const out = placeSound({ volume: Math.max(0.25, where.volume), pan: where.pan });
  if (!out || !ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(720, t0 + 0.45);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
  osc.connect(gain).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.6);
  setTimeout(() => ring(1440, 0.6, 0.1, out), 400);
}

/** A bullet on the shield: a short glassy "tink" (no blood, no thud: it didn't go through). */
export function playBountyShieldHit(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  noiseBurst({ out, duration: 0.04, volume: 0.35, filter: 'bandpass', frequency: 4200 + Math.random() * 800, q: 6 });
  ring(2100 + Math.random() * 300, 0.25, 0.07, out);
}

/**
 * The bounty claimed: coins pouring out of the outlaw's body, a long
 * rattling cascade (many quick high ticks, thinning out) and the cash
 * register's "ka-ching" on top. Positional, but never too quiet: it's the prize.
 */
export function playBountyClaimed(where: Where): void {
  const out = placeSound({ volume: Math.max(0.5, where.volume), pan: where.pan });
  if (!out) return;
  for (let i = 0; i < 24; i++) {
    const at = 0.9 * (i / 24) ** 1.6 + Math.random() * 0.02; // dense at first, then sparse
    noiseBurst({ out, start: at, duration: 0.025, volume: 0.3 * (1 - i / 30), filter: 'bandpass', frequency: 4000 + Math.random() * 3500, q: 9 });
  }
  setTimeout(() => ring(1760, 0.5, 0.12, out), 150);
  setTimeout(() => ring(2640, 0.9, 0.13, out), 230);
}

/**
 * The outlaw got away: hooves galloping off (pairs of low thuds, quieter and
 * quieter) and a mocking whistle sliding down. Not positional: it's gone.
 */
export function playOutlawEscaped(): void {
  for (let i = 0; i < 8; i++) {
    const v = 0.5 * (1 - i / 9);
    thump({ start: i * 0.2, duration: 0.07, volume: v, from: 160, to: 70 });
    thump({ start: i * 0.2 + 0.08, duration: 0.07, volume: v * 0.8, from: 140, to: 60 });
  }
  whistle(0.3, 0.25, 1320, 1175, 0.14);
  whistle(0.6, 0.8, 1175, 523, 0.16);
}

/** "Polveriera" lights a stick: a match struck on a boot (a short scrape of noise) and the flare catching ("fwoomp"). */
export function playMatchStrike(where: Where): void {
  const out = placeSound({ volume: Math.max(0.3, where.volume), pan: where.pan });
  if (!out) return;
  noiseBurst({ out, duration: 0.12, volume: 0.5, filter: 'bandpass', frequency: 3000, frequencyEnd: 5000, q: 2 });
  noiseBurst({ out, start: 0.1, duration: 0.3, volume: 0.35, filter: 'lowpass', frequency: 1500, frequencyEnd: 400 });
}

/** "Polveriera" throws: a whoosh of the arm (noise sweeping down) and a grunt (a low thump). */
export function playStickThrow(where: Where): void {
  const out = placeSound({ volume: Math.max(0.3, where.volume), pan: where.pan });
  if (!out) return;
  noiseBurst({ out, duration: 0.25, volume: 0.45, filter: 'bandpass', frequency: 2000, frequencyEnd: 500, q: 1.5 });
  thump({ out, duration: 0.12, volume: 0.35, from: 140, to: 80 });
}

/**
 * A crackle of electricity: many tiny clicks of noise, very close together
 * and at random times (an electric arc is a storm of small discharges), each
 * through a bandpass at a random high pitch. Used by the Tesla's shot and arcs.
 */
function crackle(out: AudioNode, start: number, duration: number, volume: number, clicks: number): void {
  let t = start;
  const gap = duration / clicks;
  for (let i = 0; i < clicks; i++) {
    t += gap * (0.3 + Math.random() * 1.4);
    const fade = 1 - i / (clicks + 2);
    noiseBurst({ out, start: t, duration: 0.012 + Math.random() * 0.02, volume: volume * fade, filter: 'bandpass', frequency: 2500 + Math.random() * 5000, q: 4 });
  }
}

/**
 * An electric BUZZ: a square wave (harsh, full of harmonics, the sound of
 * mains hum) whose pitch jumps at random every few milliseconds: a regular
 * buzz is a transformer, a jittery one is a spark. Through a bandpass so it
 * doesn't cover everything.
 */
function zapBuzz(out: AudioNode, start: number, duration: number, volume: number, pitch: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  for (let t = 0; t < duration; t += 0.012) {
    osc.frequency.setValueAtTime(pitch * (0.6 + Math.random() * 0.9), t0 + t);
  }
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = pitch * 4;
  filter.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(filter).connect(gain).connect(out);
  osc.start(t0);
  osc.stop(t0 + duration);
}

/**
 * The Tesla's shot: the carbine's shot (the gun is still a carbine), with
 * the coil's discharge on top: a rising whine (the coil charging in the
 * instant before), a SNAP of crackle and a buzz that dies out.
 */
export function playTeslaShot(): void {
  if (!ctx) return;
  playCarbineShot();
  const t0 = ctx.currentTime;
  const whine = ctx.createOscillator();
  whine.type = 'sawtooth';
  whine.frequency.setValueAtTime(900, t0);
  whine.frequency.exponentialRampToValueAtTime(3200, t0 + 0.08);
  whine.frequency.exponentialRampToValueAtTime(400, t0 + 0.35);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.001, t0);
  env.gain.exponentialRampToValueAtTime(0.09, t0 + 0.04);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
  whine.connect(env).connect(world);
  whine.start(t0);
  whine.stop(t0 + 0.36);
  crackle(world, 0, 0.25, 0.5, 14);
  zapBuzz(world, 0, 0.3, 0.12, 120);
}

/** A spark jumping between two enemies (where = the middle of the chain): a crackle and a short buzz. */
export function playTeslaArc(where: Where, jumps: number): void {
  const out = placeSound(where);
  if (!out) return;
  const duration = 0.15 + 0.07 * jumps;
  crackle(out, 0, duration, 0.6, 8 + 5 * jumps);
  zapBuzz(out, 0, duration, 0.15, 90 + Math.random() * 40);
  noiseBurst({ out, duration: 0.05, volume: 0.5, filter: 'highpass', frequency: 3500 }); // the snap of the first jump
}

/** An enemy still twitching from the jolt: a small crackle now and then. */
export function playTeslaTwitch(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  crackle(out, 0, 0.12, 0.25, 5);
}

// --- The lasso (render/weapons/lassoView.ts, render/lassoRope.ts) ---------------------------------------

/**
 * A rope's PLUCK: the "thwang" of a rope going taut all at once. A string
 * that's plucked starts bright and gets dull (its high harmonics die first):
 * a sawtooth (all the harmonics) through a low-pass filter that CLOSES fast.
 * Its pitch sags a little as it settles: "twaanng".
 */
function ropePluck(start: number, base: number, volume: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(base * 1.15, t0);
  osc.frequency.exponentialRampToValueAtTime(base, t0 + 0.12);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 4; // a little resonance: it "sings"
  filter.frequency.setValueAtTime(base * 14, t0);
  filter.frequency.exponentialRampToValueAtTime(base * 1.5, t0 + 0.25);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
  osc.connect(filter).connect(gain).connect(world);
  osc.start(t0);
  osc.stop(t0 + 0.4);
}

/** One turn of the spinning loop: a soft "whup" of air (louder while winding up to throw). */
export function playLassoWhirl(volume: number): void {
  if (!ctx) return;
  const v = 0.9 + Math.random() * 0.2;
  noiseBurst({ duration: 0.16, volume: 0.18 * volume, filter: 'bandpass', frequency: 260 * v, frequencyEnd: 620 * v, q: 1.4 });
}

/**
 * The throw: the loop let go (at `release` seconds from now) with a fast
 * whoosh, then the rope paying out through your glove, a hiss that fades
 * as it slows (until the catch, `catchAt`).
 */
export function playLassoThrow(release: number, catchAt: number): void {
  if (!ctx) return;
  const v = 0.9 + Math.random() * 0.2;
  noiseBurst({ start: release * 0.4, duration: 0.05, volume: 0.25, filter: 'bandpass', frequency: 700 * v, q: 5 }); // leather glove creaks
  noiseBurst({ start: release, duration: 0.18, volume: 0.7, filter: 'bandpass', frequency: 500 * v, frequencyEnd: 1800 * v, q: 1.1 }); // whoosh
  noiseBurst({ start: release + 0.02, duration: Math.max(0.1, catchAt - release), volume: 0.25, filter: 'highpass', frequency: 3500 * v }); // the rope hissing out
}

/**
 * The loop catches and you YANK: the rope snaps taut (a pluck and a dull
 * slap on the body), the rush of the pull, and your grunt (a short low
 * "hup": a thump with a quick formant-ish band of noise on top).
 */
export function playLassoCatch(): void {
  if (!ctx) return;
  const v = 0.92 + Math.random() * 0.16;
  ropePluck(0, 95 * v, 0.32);
  thump({ duration: 0.14, volume: 0.6, from: 160 * v, to: 60 }); // the slap of the loop on the body
  noiseBurst({ duration: 0.05, volume: 0.4, filter: 'bandpass', frequency: 1200 * v, q: 2 });
  noiseBurst({ start: 0.03, duration: 0.25, volume: 0.45, filter: 'bandpass', frequency: 1400 * v, frequencyEnd: 300, q: 0.9 }); // the pull
  thump({ start: 0.02, duration: 0.12, volume: 0.25, from: 210, to: 130 }); // "hup!"
  noiseBurst({ start: 0.02, duration: 0.08, volume: 0.15, filter: 'bandpass', frequency: 700, q: 6 });
}

/** Nothing caught: the loop slaps the dirt and comes back, a soft flop and a slither. */
export function playLassoMiss(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.09, volume: 0.35, filter: 'lowpass', frequency: 900, frequencyEnd: 200 });
  noiseBurst({ start: 0.06, duration: 0.2, volume: 0.2, filter: 'bandpass', frequency: 2400, frequencyEnd: 900, q: 1.2 });
}

/** The hook flies: a sharper, longer whoosh than the throw (it goes 30 m), and the rope paying out. */
export function playHookThrow(): void {
  if (!ctx) return;
  const v = 0.9 + Math.random() * 0.2;
  noiseBurst({ duration: 0.22, volume: 0.7, filter: 'bandpass', frequency: 600 * v, frequencyEnd: 2600 * v, q: 1 });
  noiseBurst({ start: 0.03, duration: 0.3, volume: 0.22, filter: 'highpass', frequency: 4000 * v });
}

/** The hook bites: a heavy wooden THUNK, the rope's creak as your weight hits it, and the pluck. */
export function playHookCatch(onEnemy: boolean): void {
  if (!ctx) return;
  const v = 0.9 + Math.random() * 0.2;
  if (onEnemy) {
    thump({ duration: 0.16, volume: 0.7, from: 150 * v, to: 55 });
    noiseBurst({ duration: 0.1, volume: 0.4, filter: 'bandpass', frequency: 900, frequencyEnd: 300, q: 1.5 }); // wet slap
  } else {
    thump({ duration: 0.12, volume: 0.65, from: 230 * v, to: 90 }); // wood
    noiseBurst({ duration: 0.04, volume: 0.45, filter: 'bandpass', frequency: 1800 * v, q: 3 });
  }
  noiseBurst({ start: 0.05, duration: 0.12, volume: 0.3, filter: 'bandpass', frequency: 450 * v, q: 9 }); // creak
  ropePluck(0.03, 80 * v, 0.25);
}

/**
 * The rope while it pulls you: a continuous CREAK (noise through a narrow
 * band, its volume wobbling slowly and irregularly, like fibers stretching)
 * and the wind of the ride. A LoopingSound like the fuse's: stopped on release.
 */
export function playRopeStrain(): LoopingSound {
  if (!ctx) return { move: () => {}, stop: () => {} };
  const audio = ctx;
  const t0 = audio.currentTime;
  const src = audio.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 380;
  filter.Q.value = 10;
  const creak = audio.createGain();
  creak.gain.value = 0.18;
  const wobbles: OscillatorNode[] = [];
  for (const [rate, depth] of [[3.1, 0.12], [7.3, 0.08]]) {
    const lfo = audio.createOscillator();
    lfo.frequency.value = rate;
    const amount = audio.createGain();
    amount.gain.value = depth;
    lfo.connect(amount).connect(creak.gain);
    lfo.start(t0);
    wobbles.push(lfo);
  }
  const wind = audio.createBiquadFilter();
  wind.type = 'lowpass';
  wind.frequency.value = 700;
  const windGain = audio.createGain();
  windGain.gain.value = 0.12;
  const volume = audio.createGain();
  volume.gain.setValueAtTime(0.0001, t0);
  volume.gain.exponentialRampToValueAtTime(1, t0 + 0.08);
  src.connect(filter).connect(creak).connect(volume);
  src.connect(wind).connect(windGain).connect(volume);
  volume.connect(world);
  src.start(t0, Math.random() * 0.5);
  let stopped = false;
  return {
    move() {},
    stop() {
      if (stopped) return;
      stopped = true;
      const now = audio.currentTime;
      volume.gain.setTargetAtTime(0, now, 0.03);
      src.stop(now + 0.2);
      for (const o of wobbles) o.stop(now + 0.2);
    },
  };
}

/** The hook lets go: the rope zipping back into your hand. */
export function playHookRelease(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.2, volume: 0.35, filter: 'bandpass', frequency: 2600, frequencyEnd: 700, q: 1.3 });
  noiseBurst({ start: 0.17, duration: 0.05, volume: 0.25, filter: 'bandpass', frequency: 800, q: 3 }); // caught in the glove
}

/** Card "Pogo": the shovel's blade bounces you up: a springy "boing" (a sine thrown UP in pitch) and the slap. */
export function playPogo(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.05, volume: 0.4, filter: 'highpass', frequency: 2000 });
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(620, t0 + 0.18);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.35, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
  osc.connect(gain).connect(world);
  osc.start(t0);
  osc.stop(t0 + 0.26);
}

/** Card "Schianto dal cielo", the dive: wind rushing past, falling in pitch. */
export function playSkyDive(): void {
  noiseBurst({ duration: 0.45, volume: 0.45, filter: 'bandpass', frequency: 1800, frequencyEnd: 400, q: 0.8 });
}

/** Card "Schianto dal cielo", the landing: a huge BOOM in the ground, the blade's clang, rubble. `size` 0..1 = how big. */
export function playSkySlam(size: number): void {
  thump({ duration: 0.7, volume: 1.2 + 0.4 * size, from: 120, to: 24 });
  noiseBurst({ duration: 0.1, volume: 0.9, filter: 'highpass', frequency: 1500 });
  noiseBurst({ duration: 0.6, volume: 0.5 + 0.3 * size, filter: 'lowpass', frequency: 900, frequencyEnd: 120 });
  ring(330, 0.7, 0.18);
}

/** Card "Fionda": the rope lets go like a slingshot band: a twang and a whoosh. */
export function playSling(): void {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110, t0);
  osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.2);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.2, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  osc.connect(gain).connect(world);
  osc.start(t0);
  osc.stop(t0 + 0.23);
  noiseBurst({ start: 0.03, duration: 0.35, volume: 0.4, filter: 'bandpass', frequency: 600, frequencyEnd: 2400, q: 0.9 });
}

/** The lasso in your hands (key 5): the coil shaken loose and the loop starting to spin. */
export function playLassoDraw(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.08, volume: 0.3, filter: 'bandpass', frequency: 900, q: 2 });
  noiseBurst({ start: 0.08, duration: 0.18, volume: 0.25, filter: 'bandpass', frequency: 300, frequencyEnd: 800, q: 1.4 });
}

/** The shovel in your hands (key 5): the blade scraping off your back, the shaft slapped into the palms. */
export function playShovelDraw(): void {
  if (!ctx) return;
  noiseBurst({ duration: 0.12, volume: 0.3, filter: 'bandpass', frequency: 3200, frequencyEnd: 1500, q: 2 });
  thump({ start: 0.15, duration: 0.08, volume: 0.4, from: 180, to: 110 });
  ring(640, 0.25, 0.04);
}

/** At the armory, the two melee weapons swapped: one laid on the counter, the other picked up (a wooden knock, a slide, a clink). */
export function playMeleeSwap(): void {
  if (!ctx) return;
  thump({ duration: 0.08, volume: 0.45, from: 200, to: 120 });
  noiseBurst({ start: 0.06, duration: 0.14, volume: 0.25, filter: 'bandpass', frequency: 1800, frequencyEnd: 900, q: 1.5 });
  ring(880, 0.2, 0.05);
}

// --- The undertaker's coffin (src/render/coffin.ts, src/sim/relics.ts) ---

/**
 * A creaking hinge: a narrow band of noise whose center slides up and down
 * a few times (a dry hinge "sings" as it turns, unevenly).
 */
function creak(out: AudioNode, start: number, duration: number, volume: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 18;
  filter.frequency.setValueAtTime(700, t0);
  const steps = 5;
  for (let i = 1; i <= steps; i++) filter.frequency.linearRampToValueAtTime(i % 2 ? 1300 + Math.random() * 400 : 650, t0 + (duration * i) / steps);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + duration * 0.15);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter).connect(gain).connect(out);
  src.start(t0, Math.random() * 0.3, duration);
}

/**
 * The coffin opens: a hinge creaks, the lid is KICKED open from inside
 * (a heavy wooden BANG and the lid slapping the trestle), a rush of hot air
 * out of the box, a ghostly sigh rising (the dead man letting go of his
 * belonging), and the relic's chime as it flies to you.
 */
export function playCoffinOpen(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  creak(out, 0, 0.35, 0.25);
  thump({ out, start: 0.3, duration: 0.18, volume: 0.7, from: 140, to: 45 });
  noiseBurst({ out, start: 0.3, duration: 0.12, volume: 0.45, filter: 'lowpass', frequency: 1400 });
  noiseBurst({ out, start: 0.52, duration: 0.07, volume: 0.35, filter: 'bandpass', frequency: 900, q: 3 }); // the lid hits the trestle
  noiseBurst({ out, start: 0.32, duration: 0.7, volume: 0.25, filter: 'bandpass', frequency: 500, frequencyEnd: 2500, q: 1 }); // the breath out of the box
  ghostVoice(out, 0.35, 220, 440, 1.0, 0.12);
  ghostVoice(out, 0.45, 330, 660, 0.9, 0.07);
}

/** The relic reaches you: a bright chime that climbs (two notes a fifth apart) and a soft clink. */
export function playRelicGet(): void {
  ring(1320, 0.9, 0.12);
  setTimeout(() => ring(1980, 1.2, 0.12), 110);
  noiseBurst({ duration: 0.04, volume: 0.2, filter: 'bandpass', frequency: 5000, q: 8 });
}

/** The lid slams shut again: a creak and a dull thud. */
export function playCoffinShut(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  creak(out, 0, 0.25, 0.15);
  thump({ out, start: 0.22, duration: 0.14, volume: 0.5, from: 120, to: 50 });
  noiseBurst({ out, start: 0.22, duration: 0.08, volume: 0.3, filter: 'lowpass', frequency: 1000 });
}

/** No money: two knocks on the lid from INSIDE (somebody in there says no). */
export function playCoffinKnock(where: Where): void {
  const out = placeSound(where);
  if (!out) return;
  for (const at of [0, 0.18]) {
    thump({ out, start: at, duration: 0.07, volume: 0.5, from: 260, to: 150 });
    noiseBurst({ out, start: at, duration: 0.03, volume: 0.3, filter: 'bandpass', frequency: 1600, q: 4 });
  }
}
