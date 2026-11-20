// Building blocks for "elastic" weapon animations (used by the reloads of
// the revolver and of the shotgun):
//
//   - GunPose + poseAt: keyframes of the WHOLE gun, as offsets from its rest
//     pose (meters and radians), blended with smoothstep.
//   - PoseSpring: the real pose follows the keyframes through a damped
//     spring per channel, so it lags, overshoots and settles: every move has
//     momentum. It also exposes the ACCELERATIONS, which drive...
//   - Hinge: a part that swings on a pin by INERTIA (the revolver's crane,
//     the shotgun's barrels): pushed by the gun's accelerations, with hard
//     stops it bounces against, a weak spring that makes sure it ends up
//     open/shut, and a latch.
//
// Both are stepped at a fixed 1/240 s by the caller: a stiff spring
// integrated with a long step becomes unstable and "explodes".

/** Pose of the whole gun: offsets from its rest pose. */
export interface GunPose {
  x: number;
  y: number;
  z: number;
  pitch: number; // + = muzzle up
  yaw: number; // + = muzzle to the left
  roll: number; // + = tilted left (counterclockwise as you see it)
}
export const ZERO_POSE: GunPose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
const CHANNELS = ['x', 'y', 'z', 'pitch', 'yaw', 'roll'] as const;

/** Fixed step for springs and hinges, seconds. */
export const ELASTIC_STEP = 1 / 240;

export function smoothstep(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}
/** Progress 0..1 of `t` between `a` and `b` (clamped). */
export function phase(t: number, a: number, b: number): number {
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}

/** The pose at time t (0..1), blending the two keyframes around it. Keys: [t, pose], sorted. */
export function poseAt(keys: [number, GunPose][], t: number): GunPose {
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, a] = keys[i];
    const [tb, b] = keys[i + 1];
    if (t <= tb) {
      const k = smoothstep((t - ta) / (tb - ta));
      const out = { ...ZERO_POSE };
      for (const c of CHANNELS) out[c] = a[c] + (b[c] - a[c]) * k;
      return out;
    }
  }
  return { ...ZERO_POSE };
}

/** A damped spring per channel: the pose chases a target. */
export class PoseSpring {
  readonly pose: GunPose = { ...ZERO_POSE };
  readonly vel: GunPose = { ...ZERO_POSE };
  /** The acceleration of each channel in the last step (what a hinge feels). */
  readonly acc: GunPose = { ...ZERO_POSE };
  private damping: number;

  /** stiffness = ω² (1/s²); dampingRatio < 1 overshoots, 1 = no overshoot. */
  constructor(
    private stiffness: number,
    dampingRatio: number,
  ) {
    this.damping = 2 * dampingRatio * Math.sqrt(stiffness);
  }

  step(target: GunPose, dt: number): void {
    for (const c of CHANNELS) {
      // Semi-implicit Euler: velocity first, then position with the new velocity.
      this.acc[c] = this.stiffness * (target[c] - this.pose[c]) - this.damping * this.vel[c];
      this.vel[c] += this.acc[c] * dt;
      this.pose[c] += this.vel[c] * dt;
    }
  }
}

/** A part swinging on a pin, between 0 (shut) and `max` (open), moved by inertia. */
export class Hinge {
  angle = 0;
  vel = 0;
  latched = true;

  constructor(
    private max: number,
    /** Spring toward the goal (open or shut): makes sure the result comes. */
    private assist: number,
    private damping: number,
    /** Speed kept when it hits the open stop (0 = dead stop, 1 = full bounce). */
    private bounce: number,
  ) {}

  reset(): void {
    this.angle = 0;
    this.vel = 0;
    this.latched = true;
  }

  /**
   * `drive`: angular acceleration from the gun's motion (inertia), rad/s².
   * `open`: true while it's allowed (and wants) to be open; when false it
   * goes back to 0 and latches there.
   */
  step(drive: number, open: boolean, dt: number): void {
    if (open) this.latched = false;
    if (this.latched) {
      this.angle = 0;
      this.vel = 0;
      return;
    }
    const goal = open ? this.max : 0;
    const acc = drive + this.assist * (goal - this.angle) - this.damping * this.vel;
    this.vel += acc * dt;
    this.angle += this.vel * dt;
    if (this.angle > this.max) {
      this.angle = this.max; // the stop: bounce back a little
      this.vel = -this.vel * this.bounce;
    }
    if (this.angle <= 0) {
      this.angle = 0;
      this.vel = 0;
      if (!open) this.latched = true; // shut and latched: CLICK
    }
  }
}
