// Health, bottom-left: the number in dried-blood red and a thin gauge under
// it, no frame (look "blood and ash"). At low health the number throbs like
// a heartbeat, faster as you get closer to death.
// Markup and CSS in index.html (#health-plate); from here we only change
// text, CSS variables and transforms, every frame.
//
// The gauge has two layers:
//   - the red fill = your health right now;
//   - the pale "ghost" behind it = your health a moment ago. After a hit it
//     waits a little, then drains down to the red one: the strip between the
//     two shows HOW MUCH that hit cost you (a fighting-game trick).
import { tuning } from '../sim/config';
import { heartbeat } from './lowHealth';
import './fonts'; // the number is written in Rye

// --- Tuning ---
/** Seconds the ghost waits after a hit before draining. */
const GHOST_HOLD = 0.45;
/** How fast the ghost drains, in "whole bar per second". */
const GHOST_DRAIN = 0.8;
/** How fast the red fill catches up with the real value (higher = snappier). */
const FILL_SPEED = 20;
/** Size of the "bump" of each beat (0.08 = 8% bigger); the red also lights up. */
const BEAT_SCALE = 0.08;
/** Seconds and size of the number's jolt when you get hit. */
const HIT_TIME = 0.25;
const HIT_SCALE = 0.15;

const number = document.getElementById('health-number')!;
const fill = document.getElementById('health-fill')!;
const ghost = document.getElementById('health-ghost')!;

let shown = 1; // red fill, 0..1 (eases towards the real value)
let ghostValue = 1; // ghost, 0..1
let ghostWait = 0; // seconds before the ghost starts draining
let lastHealth = tuning.playerMaxHealth;
let hitTime = 0; // seconds left of the number's jolt

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

  // Heartbeat (only at low health): the same one as the blood on the screen
  // edges and the sound, owned by lowHealth.ts.
  const beat = heartbeat();
  // The CSS mixes the dark red with a bright one by this amount (color-mix).
  number.style.setProperty('--lit', String(Math.min(1, beat)));

  // Hit jolt: starts big and shrinks back (the square makes it ease out).
  // One transform for both effects: setting it twice would keep only the last.
  hitTime = Math.max(0, hitTime - dt);
  const t = hitTime / HIT_TIME;
  number.style.transform = `scale(${1 + HIT_SCALE * t * t + BEAT_SCALE * beat})`;
}
