// The vildenaro counter, top-right under the score: the coin pile (the same
// pixels as the pickup on the ground) and the number in gold Rye.
// Markup and CSS in index.html (#money-box); from here we only change text,
// classes and transforms, every frame.
//
// Two tricks borrowed from arcade games and slot machines:
//   - the number doesn't jump: it COUNTS UP to the new value, like a cash
//     register. Your eye catches the movement, and money that "flows in"
//     feels like more than money that just appears;
//   - a "+30" pops out under the counter and adds up while you keep
//     collecting (a bull's five piles = one "+50", not five tiny ones),
//     then fades. It says how much THAT kill was worth.
import { coinIcon } from './pickupSprites';
import './fonts'; // the number is written in Rye

// --- Tuning ---
/** Count-up speed: the minimum, in vildenaro per second... */
const COUNT_MIN_RATE = 60;
/** ...and the share of the remaining gap covered per second (big sums don't take forever). */
const COUNT_CATCH_UP = 6;
/** Seconds the "+N" stays fully visible after the last coin, then how long it takes to fade. */
const GAIN_HOLD = 1.1;
const GAIN_FADE = 0.5;
/** Seconds and size of the number's bump when money comes in. */
const BUMP_TIME = 0.18;
const BUMP_SCALE = 0.18;

const box = document.getElementById('money-box')!;
const number = document.getElementById('money')!;
const gainEl = document.getElementById('money-gain')!;
box.prepend(Object.assign(coinIcon(), { id: 'money-icon' }));

let shown = 0; // the number on screen: a float, it counts up towards the real value
let last = 0; // the real value last frame
let gain = 0; // the "+N" being added up
let gainTime = 0; // seconds since the last coin (the "+N" fades after GAIN_HOLD)
let bump = 0; // seconds left of the bump

export function updateMoneyHud(money: number, dt: number): void {
  if (money > last) {
    gain += money - last;
    gainTime = 0;
    bump = BUMP_TIME;
  } else if (money < last) {
    // Spent (one day, at the shop) or dead: no counting down, the number is
    // just the truth. And no "+N" left over from before.
    shown = money;
    gain = 0;
  }
  last = money;

  // Count up: cover a share of the gap (fast for big sums) but at least
  // COUNT_MIN_RATE per second (so the last few coins don't crawl).
  const gap = money - shown;
  if (gap > 0) shown = Math.min(money, shown + Math.max(COUNT_MIN_RATE * dt, gap * (1 - Math.exp(-COUNT_CATCH_UP * dt))));
  number.textContent = String(Math.floor(shown));

  // The bump: scale up at once, then back to 1 (linear is enough at this speed).
  bump = Math.max(0, bump - dt);
  number.style.transform = `scale(${1 + BUMP_SCALE * (bump / BUMP_TIME)})`;

  // The "+N": fully visible for GAIN_HOLD seconds, then fades out and resets.
  gainTime += dt;
  const fade = 1 - Math.max(0, gainTime - GAIN_HOLD) / GAIN_FADE;
  if (fade <= 0) gain = 0;
  gainEl.textContent = gain > 0 ? `+${gain}` : '';
  gainEl.style.opacity = String(Math.max(0, fade));
  gainEl.style.transform = `translateY(${-6 * Math.max(0, 1 - fade)}px)`; // drifts up while fading
}
