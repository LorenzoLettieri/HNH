// Low health, CoD style: when your health drops below LOW_HEALTH, blood
// creeps in from the screen edges, the picture loses its colors and a
// heartbeat thumps, faster and faster as you get closer to death. Heal up
// (or just get above the threshold) and it all fades away.
//
// This file also owns THE heartbeat: the health number (healthPlate.ts)
// reads heartbeat() from here, so number, blood and sound pulse together.
//
// The blood is a texture drawn once on a small canvas (procedural, like the
// props' textures), shown full screen by the #low-health layer in index.html
// and scaled up without smoothing (pixelated), like the 3D picture.
import { seededRandom } from './props/pixelCanvas';
import { playHeartbeat } from '../audio/sfx';

// --- Tuning ---
/** Below this fraction of health the effect starts (and the number throbs). */
export const LOW_HEALTH = 0.35;
/** Heartbeats per second: at the threshold and at (almost) zero health. */
const BEAT_HZ_CALM = 1.1;
const BEAT_HZ_PANIC = 2.8;
/** Where the second bump ("dub") starts, as a fraction of the beat. */
const DUB_AT = 0.18;
/** Intensity of the effect right below the threshold (it grows to 1 at zero health). */
const INTENSITY_START = 0.25;
/** Opacity of the blood at the threshold and near death (before the beat). */
const BLOOD_MIN = 0.35;
const BLOOD_MAX = 0.85;
/** How much each beat adds to the blood's opacity. */
const BLOOD_BEAT = 0.2;
/** Colors left in the picture near death (1 = all, 0 = black and white). */
const MIN_SATURATION = 0.35;
/** How fast the effect fades in and out (higher = faster). */
const FADE_RATE = 4;
/** Texture size: small on purpose, it's scaled up to the screen in big pixels. */
const TEX_W = 240;
const TEX_H = 135;

// --- The blood texture ---
function drawBlood(): string {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(1337); // same seed = same picture every time

  // 1. A darkening toward the edges, so the blood has something to sit on.
  const g = ctx.createRadialGradient(TEX_W / 2, TEX_H / 2, TEX_H * 0.3, TEX_W / 2, TEX_H / 2, TEX_W * 0.6);
  g.addColorStop(0, 'rgba(50, 0, 0, 0)');
  g.addColorStop(0.6, 'rgba(60, 2, 0, 0.55)');
  g.addColorStop(1, 'rgba(30, 0, 0, 0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // 2. Blood blobs along the border: a random point on one of the 4 edges,
  //    pushed a little inward, as a small circle. Many small ones make a
  //    ragged edge (a few big ones would look like cartoon balls).
  //    Three dark reds, so it isn't a flat color.
  const colors = ['#320202', '#4a0404', '#620a06'];
  for (let i = 0; i < 700; i++) {
    const edge = Math.floor(rand() * 4);
    const along = rand();
    const depth = rand() ** 3 * 18; // cubed: most blobs hug the edge
    const r = (1 - depth / 18) * (1 + rand() * 4) + 0.5;
    let x: number, y: number;
    if (edge === 0) [x, y] = [along * TEX_W, depth]; // top
    else if (edge === 1) [x, y] = [along * TEX_W, TEX_H - depth]; // bottom
    else if (edge === 2) [x, y] = [depth * 1.2, along * TEX_H]; // left
    else [x, y] = [TEX_W - depth * 1.2, along * TEX_H]; // right
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Drips running down from the top edge, each ending in a round drop.
  for (let i = 0; i < 9; i++) {
    const x = rand() * TEX_W;
    const len = 6 + rand() ** 2 * 18;
    const w = 1;
    ctx.fillStyle = colors[i % 2];
    ctx.fillRect(x, 0, w, len);
    ctx.beginPath();
    ctx.arc(x + w / 2, len, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.toDataURL();
}

const layer = document.getElementById('low-health')!;
layer.style.backgroundImage = `url(${drawBlood()})`;
const gray = document.getElementById('low-health-gray')!;

let intensity = 0; // 0..1, eased: how strong the effect is
let beatPhase = 0; // 0..1, where we are in the current heartbeat
let beat = 0; // the current beat's bump, 0..~1

/** The current heartbeat bump (0 = rest), for the effects that pulse with it. */
export function heartbeat(): number {
  return beat;
}

/** Call every frame, BEFORE the things that read heartbeat(). frac = health 0..1. */
export function updateLowHealth(frac: number, dead: boolean, dt: number): void {
  // How close to death, 0 at the threshold, 1 at zero health (and 0 above the threshold).
  const low = frac < LOW_HEALTH && !dead;
  const panic = low ? 1 - frac / LOW_HEALTH : 0;
  // The effect starts at INTENSITY_START, not 0: crossing the threshold must be noticed.
  const target = low ? INTENSITY_START + (1 - INTENSITY_START) * panic : 0;
  intensity = target + (intensity - target) * Math.exp(-FADE_RATE * dt);

  // Heartbeat: the rate grows as health drops. We advance a phase instead of
  // computing sin(time * rate): with a changing rate that would jump around
  // (the same trick as the style letter's blinking).
  beat = 0;
  if (low) {
    const prev = beatPhase;
    beatPhase = (beatPhase + (BEAT_HZ_CALM + (BEAT_HZ_PANIC - BEAT_HZ_CALM) * panic) * dt) % 1;
    // "Lub-dub": two short bumps close together, the second one smaller, then rest.
    beat = pulse(beatPhase, 0, 1) + pulse(beatPhase, DUB_AT, 0.6);
    // Sounds when the phase crosses the start of each bump (wrapping counts as crossing 0).
    const volume = 0.4 + 0.6 * panic;
    if (beatPhase < prev) playHeartbeat(volume);
    else if (prev < DUB_AT && beatPhase >= DUB_AT) playHeartbeat(volume * 0.6);
  } else beatPhase = 0;

  // Hidden when it adds nothing: a full-screen layer costs GPU time even if transparent.
  const visible = intensity > 0.01;
  layer.hidden = !visible;
  if (visible) {
    const base = BLOOD_MIN + (BLOOD_MAX - BLOOD_MIN) * intensity;
    layer.style.opacity = String(Math.min(1, base + BLOOD_BEAT * beat));
  }
  // Colors drain out of the picture: a gray layer with mix-blend-mode
  // "saturation" keeps the brightness of what's below and takes the
  // saturation of the gray (zero); its opacity says how much color goes.
  // (Not a CSS filter on the 3D canvas: that would make the canvas a new
  // stacking context, drawn ABOVE the whole HUD since it's last in <body>.)
  gray.hidden = !visible;
  if (visible) gray.style.opacity = String((1 - MIN_SATURATION) * intensity);
}

/** A half sine wave lasting 1/8 of the beat, starting at `start`, as tall as `height`. */
function pulse(phase: number, start: number, height: number): number {
  const t = (phase - start) * 8;
  return t > 0 && t < 1 ? Math.sin(t * Math.PI) * height : 0;
}
