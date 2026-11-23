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
//   - Stroke: a part THROWN by the hand from one stop to the other and
//     bouncing on it (the carbine's lever, the pump-action's fore-end).
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

/**
 * How to KICK a damped spring at rest so that its peak is exactly 1 (the
 * recoil of a shot, recoil.ts; the camera's shot punch, cameraFeel.ts).
 * Two parts: a `jump` (an instant displacement: the shot moves the gun in the
 * very frame it fires, no delay) and a `speed` (it keeps going a bit further,
 * then the spring brings it back, past the rest and back again). `snap` = the
 * share of the jump (0 = only speed, a softer start).
 * The peak of a spring is linear in its starting state: kick it twice as
 * hard and it goes twice as far. So we simulate one unit kick, measure its
 * peak and divide by it. Cached: it only depends on the three numbers.
 */
const kickCache = new Map<string, { jump: number; speed: number }>();
export function springKick(stiffness: number, dampingRatio: number, snap: number): { jump: number; speed: number } {
  const key = `${stiffness}|${dampingRatio}|${snap}`;
  const cached = kickCache.get(key);
  if (cached) return cached;
  const omega = Math.sqrt(stiffness);
  const damping = 2 * dampingRatio * omega;
  let x = snap;
  let v = omega;
  let peak = x;
  for (let i = 0; i < 480 && v > 0; i++) {
    v += (-stiffness * x - damping * v) * ELASTIC_STEP;
    x += v * ELASTIC_STEP;
    peak = Math.max(peak, x);
  }
  const kick = { jump: snap / peak, speed: omega / peak };
  kickCache.set(key, kick);
  return kick;
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

/**
 * A part THROWN by the hand between two stops: the carbine's lever (an
 * angle, radians), the pump-action's fore-end (a slide, meters). A tiny
 * physics simulation of one number and its speed: the hand pushes it toward
 * one of the two stops with a CONSTANT force (so it keeps accelerating until
 * it hits), and every stop bounces it back with part of its speed: a few
 * smaller and smaller hops, then it rests. Compared to a keyframe this gets
 * the two things that make it satisfying for free: the speed is highest
 * exactly at the impact, and the impact has a rebound.
 */
export class Stroke {
  /** 0 = shut (at rest), `travel` = fully open. */
  pos = 0;
  vel = 0;
  /** Speed of the last impact against a stop (+ = the open stop; consumed by whoever reacts to it). */
  impact = 0;

  constructor(
    /** Distance between the two stops. */
    readonly travel: number,
    /** How hard the hand throws it open / slams it shut (units/s²). */
    readonly pushOpen: number,
    readonly pushShut: number,
    /** Speed kept when it hits a stop (0 = dead stop, 1 = bounces forever). */
    private bounceOpen: number,
    private bounceShut: number,
    /** Below this speed a bounce is over: it rests against the stop. */
    private restSpeed: number,
  ) {}

  reset(): void {
    this.pos = 0;
    this.vel = 0;
    this.impact = 0;
  }

  step(open: boolean, dt: number): void {
    this.vel += (open ? this.pushOpen : -this.pushShut) * dt;
    this.pos += this.vel * dt;
    if (this.pos >= this.travel && this.vel > 0) {
      this.pos = this.travel;
      this.hit(this.bounceOpen);
    } else if (this.pos <= 0 && this.vel < 0) {
      this.pos = 0;
      this.hit(this.bounceShut);
    }
  }

  private hit(bounce: number): void {
    if (Math.abs(this.vel) > this.restSpeed * 4) this.impact = this.vel; // a real slam, not a resting nudge
    this.vel = -this.vel * bounce;
    if (Math.abs(this.vel) < this.restSpeed) this.vel = 0;
  }
}

/**
 * How long a Stroke takes to cover `distance` from a stop, pushed at a
 * constant `acc` (for timing the sounds on the animation). Uniform
 * acceleration from rest, the school formula: distance = ½·a·t², so
 * t = √(2·distance / a).
 */
export function travelTime(distance: number, acc: number): number {
  return Math.sqrt((2 * distance) / acc);
}
