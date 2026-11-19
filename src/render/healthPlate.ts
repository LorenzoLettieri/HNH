// The health plate, bottom-left: a wooden plate with a brass rim holding a
// pixel-art heart, the health number and a gauge.
// Markup and CSS in index.html (#health-plate); from here we only change
// text, CSS variables and transforms, every frame.
//
// The gauge has two layers:
//   - the red fill = your health right now;
//   - the pale "ghost" behind it = your health a moment ago. After a hit it
//     waits a little, then drains down to the red one: the strip between the
//     two shows HOW MUCH that hit cost you (a fighting-game trick).
import { tuning } from '../sim/config';
import './fonts'; // the number is written in Rye

// --- Tuning ---
/** Seconds the ghost waits after a hit before draining. */
const GHOST_HOLD = 0.45;
/** How fast the ghost drains, in "whole bar per second". */
const GHOST_DRAIN = 0.8;
/** How fast the red fill catches up with the real value (higher = snappier). */
const FILL_SPEED = 20;
/** Below this fraction of health the number turns red and the heart beats fast. */
const LOW_HEALTH = 0.3;
/** Heartbeats per second: at full health and at (almost) zero health. */
const BEAT_HZ_CALM = 0.9;
const BEAT_HZ_PANIC = 3;
/** Size of the "bump" of each beat (0.15 = 15% bigger). */
const BEAT_SCALE = 0.15;
/** Seconds and size of the number's jolt when you get hit. */
const HIT_TIME = 0.25;
const HIT_SCALE = 0.35;

// --- The heart, pixel by pixel ---
// One character = one pixel: '#' outline, 'r' red, 'h' highlight, 'd' shadow,
// '.' transparent. 11 × 10 px, scaled up by CSS with image-rendering: pixelated
// (= no smoothing: the same NearestFilter the 3D picture uses).
const HEART = [
  '.###...###.',
  '#hhr#.#rrr#',
  '#hrrr#rrrr#',
  '#rrrrrrrrd#',
  '#rrrrrrrrd#',
  '.#rrrrrrd#.',
  '..#rrrrd#..',
  '...#rrd#...',
  '....#d#....',
  '.....#.....',
];
const HEART_COLORS: Record<string, string> = { '#': '#120604', r: '#c81c10', h: '#ff8a6a', d: '#6e0a06' };

function drawHeart(canvas: HTMLCanvasElement): void {
  canvas.width = HEART[0].length;
  canvas.height = HEART.length;
  const ctx = canvas.getContext('2d')!;
  HEART.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = HEART_COLORS[ch];
      if (!color) return; // '.' = transparent
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
  });
}

const plate = document.getElementById('health-plate')!;
const heart = document.getElementById('health-heart') as HTMLCanvasElement;
const number = document.getElementById('health-number')!;
const fill = document.getElementById('health-fill')!;
const ghost = document.getElementById('health-ghost')!;
drawHeart(heart);

let shown = 1; // red fill, 0..1 (eases towards the real value)
let ghostValue = 1; // ghost, 0..1
let ghostWait = 0; // seconds before the ghost starts draining
let lastHealth = tuning.playerMaxHealth;
let hitTime = 0; // seconds left of the number's jolt
let beatPhase = 0; // 0..1, where we are in the current heartbeat

export function updateHealthPlate(health: number, dt: number): void {
  const max = tuning.playerMaxHealth;
  const frac = Math.max(0, Math.min(1, health / max));

  if (health < lastHealth) {
    // Hit: the ghost stays where it was and waits; the number jolts.
    ghostWait = GHOST_HOLD;
    hitTime = HIT_TIME;
  }
  lastHealth = health;

  // Red fill: exponential easing, the same as the style bar. Each frame it
  // covers a fixed share of the remaining distance: fast at first, then
  // gentle. 1 - exp(-k·dt) makes the result the same at any frame rate.
  shown += (frac - shown) * (1 - Math.exp(-FILL_SPEED * dt));

  // Ghost: never below the real health (healing pulls it up at once),
  // after a hit it waits, then drains at constant speed.
  if (ghostValue < frac) ghostValue = frac;
  else if (ghostWait > 0) ghostWait -= dt;
  else ghostValue = Math.max(frac, ghostValue - GHOST_DRAIN * dt);

  // scaleX instead of width: a transform doesn't make the browser redo the layout.
  fill.style.transform = `scaleX(${shown})`;
  ghost.style.transform = `scaleX(${ghostValue})`;

  number.textContent = String(Math.ceil(health));
  const low = frac < LOW_HEALTH;
  plate.classList.toggle('low', low);

  // Number jolt: starts big and shrinks back (the square makes it ease out).
  hitTime = Math.max(0, hitTime - dt);
  const t = hitTime / HIT_TIME;
  number.style.transform = `scale(${1 + HIT_SCALE * t * t})`;

  // Heartbeat: the rate grows as health drops. We advance a phase instead of
  // computing sin(time * rate): with a changing rate that would jump around
  // (the same trick as the style letter's blinking).
  const hz = BEAT_HZ_CALM + (BEAT_HZ_PANIC - BEAT_HZ_CALM) * (1 - frac);
  beatPhase = (beatPhase + hz * dt) % 1;
  // "Lub-dub": two short bumps close together, the second one smaller, then rest.
  heart.style.transform = `scale(${1 + BEAT_SCALE * (pulse(beatPhase, 0, 1) + pulse(beatPhase, 0.18, 0.6))})`;
}

/** A half sine wave lasting 1/8 of the beat, starting at `start`, as tall as `height`. */
function pulse(phase: number, start: number, height: number): number {
  const t = (phase - start) * 8;
  return t > 0 && t < 1 ? Math.sin(t * Math.PI) * height : 0;
}
