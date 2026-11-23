// The revolver's draw signature (weapon switch, viewmodel.ts DRAW_KEYS): the
// gunslinger's twirl. The revolver comes in spinning one full turn round the
// index finger (RevolverModel.spin, the akimbo spin's pivot), with the same
// EASE-OUT as the akimbo reload (fast at first, slowing down until it stops
// in the hand); the hand CATCHES it (a small jolt and a view punch in
// viewmodel.ts), then the hammer is thumbed back, "click": ready to fire.
// Akimbo: the left gun does the same, a moment later.
// Everything in fractions of weaponSwitchTime (the draw's progress, 0..1).
import { tuning } from '../../sim/config';
import { phase, smoothstep } from './elastic';

/** The spin: from here to here (the catch). */
const SPIN_FROM = 0.05;
export const SPIN_TO = 0.76;
/** The left gun (akimbo) is this much later. */
export const LEFT_LAG = 0.1;
/** The hammer goes back (cocked) between these: it hangs fallen while spinning. */
const COCK_FROM = 0.8;
const COCK_TO = 0.93;

/** Spin angle at draw progress k, radians (rotation.x of RevolverModel.spin: positive flips the muzzle up and back). */
export function drawSpin(k: number, left: boolean): number {
  const u = phase(k, SPIN_FROM + (left ? LEFT_LAG : 0), SPIN_TO + (left ? LEFT_LAG : 0));
  if (u <= 0 || u >= 1) return 0;
  return Math.PI * 2 * (1 - (1 - u) ** 3); // ease-out: one full turn
}

/** How "fallen" the hammer is at draw progress k (1 = fallen, 0 = cocked). */
export function drawHammer(k: number, left: boolean): number {
  const lag = left ? LEFT_LAG * 0.5 : 0;
  return 1 - smoothstep(phase(k, COCK_FROM + lag, COCK_TO + lag));
}

/** When the moments of the draw happen, seconds after 'weaponSwitch', for the sounds. */
export function revolverDrawTimes(): { spinAt: number; catchAt: number; cockAt: number; leftLag: number } {
  const d = tuning.weaponSwitchTime;
  return { spinAt: SPIN_FROM * d, catchAt: SPIN_TO * d, cockAt: COCK_FROM * d + 0.02, leftLag: LEFT_LAG * d };
}
