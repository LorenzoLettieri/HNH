// The akimbo revolvers' reload: the gunslinger's SPIN. Both guns are twirled
// round the index finger (RevolverModel.spin: a pivot on the trigger guard),
// three full turns, and when they stop in the hand they're loaded. Not a real
// reload, pure show: the simulation simply refills the cylinders after
// akimboReloadTime (the 'reloadStart' event with spin = true).
//
// The motion: a flick, so it starts at full speed and slows down until it
// settles in the hand (an EASE-OUT: angle = turns × (1 − (1 − u)³), u = 0..1
// over the reload; its slope, the speed, is highest at u = 0 and zero at
// u = 1). The left gun starts a moment later and catches up: they finish
// together, but the two hands don't move like one mirrored copy.
// Meanwhile the guns dip a little and tilt outward (a pose offset, like the
// other reloads' keyframes: see elastic.ts).
import { ZERO_POSE, type GunPose } from './elastic';

/** Full turns of each gun. */
export const SPIN_TURNS = 3;
/** The left gun starts this many seconds after the right one. */
const LEFT_DELAY = 0.08;
/** During the spin the guns drop by this much (m) and tilt outward by this much (rad), most in the middle. */
const DIP = 0.03;
const TILT = 0.3;

/** Angle of a spin at progress u (0..1), radians: the ease-out curve. */
function spinAngle(u: number): number {
  const k = Math.min(1, Math.max(0, u));
  return SPIN_TURNS * Math.PI * 2 * (1 - (1 - k) ** 3);
}

/**
 * When each turn of the RIGHT gun completes, seconds from the start: the
 * moments the "whoosh" of the sound should land (sfx.ts). Solving the curve
 * backwards: 1 − (1 − u)³ = n / turns → u = 1 − (1 − n / turns)^(1/3).
 */
export function spinTurnTimes(seconds: number): number[] {
  const times: number[] = [];
  for (let n = 1; n <= SPIN_TURNS; n++) times.push(seconds * (1 - Math.cbrt(1 - n / SPIN_TURNS)));
  return times;
}

export interface AkimboSpin {
  readonly active: boolean;
  start(seconds: number): void;
  cancel(): void;
  /** Every frame: each gun's spin angle (radians, rotation.x of RevolverModel.spin) and the pose offset of both. */
  update(dt: number): { right: number; left: number; pose: GunPose };
}

export function createAkimboSpin(): AkimboSpin {
  let time = Infinity; // seconds since the start (Infinity = not spinning)
  let length = 1;
  const pose: GunPose = { ...ZERO_POSE };
  return {
    get active() {
      return time < length;
    },
    start(seconds) {
      time = 0;
      length = Math.max(0.1, seconds);
    },
    cancel() {
      time = Infinity;
    },
    update(dt) {
      time += dt;
      if (time >= length) return { right: 0, left: 0, pose: ZERO_POSE };
      const u = time / length;
      const uLeft = (time - LEFT_DELAY) / (length - LEFT_DELAY);
      // The dip and the tilt: a half sine, 0 at both ends, most in the middle.
      const swell = Math.sin(Math.PI * u);
      pose.y = -DIP * swell;
      pose.roll = -TILT * swell; // the right gun tilts right; the left one is its mirror image
      // Positive rotation.x lifts the muzzle: it flips up and back over the hand, the gunslinger's way.
      return { right: spinAngle(u), left: spinAngle(uLeft), pose };
    },
  };
}
