// Health bar, bottom-left, under the wave number (look "blood and ash": no
// frame, a thin line on the picture). Health has no number on purpose: you
// read it at a glance from the bar (and, later, from the red screen edges).
// Markup and CSS in index.html (#health-gauge); from here we only change
// transforms, every frame.
//
// The bar has two layers:
//   - the red fill = your health right now;
//   - the pale "ghost" behind it = your health a moment ago. After a hit it
//     waits a little, then drains down to the red one: the strip between the
//     two shows HOW MUCH that hit cost you (a fighting-game trick).
import { tuning } from '../sim/config';

// --- Tuning ---
/** Seconds the ghost waits after a hit before draining. */
const GHOST_HOLD = 0.45;
/** How fast the ghost drains, in "whole bar per second". */
const GHOST_DRAIN = 0.8;
/** How fast the red fill catches up with the real value (higher = snappier). */
const FILL_SPEED = 20;

const fill = document.getElementById('health-fill')!;
const ghost = document.getElementById('health-ghost')!;

let shown = 1; // red fill, 0..1 (eases towards the real value)
let ghostValue = 1; // ghost, 0..1
let ghostWait = 0; // seconds before the ghost starts draining
let lastHealth = tuning.playerMaxHealth;

export function updateHealthBar(health: number, dt: number): void {
  const frac = Math.max(0, Math.min(1, health / tuning.playerMaxHealth));

  // Hit: the ghost stays where it was and waits.
  if (health < lastHealth) ghostWait = GHOST_HOLD;
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
}
