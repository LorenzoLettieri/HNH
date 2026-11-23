// The SHOT's kick, for every gun: how the gun in your hand and your view
// react when it fires. Purely visual (the aim never moves).
//
// It used to be "jump to the top, then slide back exponentially": correct,
// but dead. Now the gun is on a damped SPRING per channel (elastic.ts), and
// a shot KICKS the spring (springKick): it jumps most of the way in the very
// frame of the shot (no delay: the shot is instant), keeps flying up a few
// milliseconds more (follow-through), then the spring yanks it back, PAST its
// rest pose (it dips below, ~25% with a damping ratio of 0.4) and back again:
// the "bounce" that tells your eye the gun is heavy and your wrist is strong.
// Every shot is a bit different: a random sideways throw (yaw) and twist
// (roll), on top of a twist that always goes the same way. Shots in quick
// succession (fanning, the double barrel's two barrels) ADD UP: the spring
// already moving gets kicked again.
//
// The view gets its own kick (cameraFeel.ts shotKick): a punch up, a small
// tilt to a random side and a FOV that widens for an instant (the blast
// pushes the world away from you).
import type { WeaponId } from '../../sim/weapon';
import { ELASTIC_STEP, springKick, ZERO_POSE, type GunPose } from './elastic';

// (A type, not an interface: the debug panel binds plain objects, and only
// type aliases count as "any object with string keys" for TypeScript.)
export type RecoilProfile = {
  /** Muzzle flip at the peak, radians (the gun turns round the hand on the grip). */
  up: number;
  /** Shoved back into the hand (or the shoulder), meters. */
  back: number;
  /** The hand rises with it, meters. */
  rise: number;
  /** Twist (roll) that always goes this way, radians (+ = tilted left, toward the middle of the screen). */
  twist: number;
  /** Random throw on every shot, sideways (yaw) and in the twist, up to ± this, radians. */
  scatter: number;
  /** The spring: stiffness (higher = faster) and damping ratio (lower = more bounce past the rest; 1 = none). */
  stiffness: number;
  bounce: number;
  /** Share of the kick that happens in the very frame of the shot (0..1; the rest is speed: it flies there). */
  snap: number;
  /** The view: punch up (radians), tilt to a random side (radians), FOV widened (degrees). */
  view: number;
  viewRoll: number;
  fov: number;
};

/** Which recoil: each gun, and the pump-action (the Forge's shotgun) apart from the double barrel. */
export type RecoilKind = WeaponId | 'pump';

/**
 * Mutable so the debug panel can change them (folder "Recoil").
 * The revolver: a snappy flip and back. The shotgun: slower and heavier,
 * slammed back into the shoulder, a big punch and FOV kick. The carbine: in
 * between (aimed it kicks less: viewmodelSettings.rifleAdsRecoil).
 */
export const recoilSettings: Record<RecoilKind, RecoilProfile> = {
  revolver: {
    up: 0.5,
    back: 0.05,
    rise: 0.012,
    twist: 0.08,
    scatter: 0.06,
    stiffness: 1100,
    bounce: 0.38,
    snap: 0.5,
    view: 0.025,
    viewRoll: 0.008,
    fov: 1.2,
  },
  shotgun: {
    up: 0.32,
    back: 0.11,
    rise: 0.02,
    twist: 0.1,
    scatter: 0.07,
    stiffness: 420,
    bounce: 0.4,
    snap: 0.55,
    view: 0.06,
    viewRoll: 0.022,
    fov: 5,
  },
  pump: {
    up: 0.3,
    back: 0.12,
    rise: 0.02,
    twist: 0.1,
    scatter: 0.06,
    stiffness: 420,
    bounce: 0.4,
    snap: 0.55,
    view: 0.06,
    viewRoll: 0.02,
    fov: 5,
  },
  rifle: {
    up: 0.22,
    back: 0.07,
    rise: 0.01,
    twist: 0.06,
    scatter: 0.03,
    stiffness: 650,
    bounce: 0.4,
    snap: 0.55,
    view: 0.04,
    viewRoll: 0.012,
    fov: 2.5,
  },
};

const CHANNELS = ['x', 'y', 'z', 'pitch', 'yaw', 'roll'] as const;

/** The recoil of ONE gun in your hand (the akimbo has two): a pose offset driven by a spring. */
export class RecoilSpring {
  /** Offset from the rest pose (z + = back toward you, pitch + = muzzle up). */
  readonly pose: GunPose = { ...ZERO_POSE };
  private readonly vel: GunPose = { ...ZERO_POSE };
  /** The last kick's profile: its spring brings the gun back. */
  private profile: RecoilProfile = recoilSettings.revolver;
  private clock = 0;

  /** A shot: `scale` = how strong (1 = the profile's numbers). */
  kick(p: RecoilProfile, scale = 1): void {
    this.profile = p;
    const { jump, speed } = springKick(p.stiffness, p.bounce, p.snap);
    const random = () => Math.random() * 2 - 1;
    const peak: GunPose = {
      x: 0,
      y: p.rise,
      z: p.back,
      pitch: p.up,
      yaw: random() * p.scatter,
      roll: p.twist + random() * p.scatter,
    };
    for (const c of CHANNELS) {
      this.pose[c] += peak[c] * scale * jump;
      this.vel[c] += peak[c] * scale * speed;
    }
  }

  /** A weapon switch: the new gun starts still. */
  reset(): void {
    for (const c of CHANNELS) {
      this.pose[c] = 0;
      this.vel[c] = 0;
    }
  }

  update(dt: number): void {
    const k = this.profile.stiffness;
    const damping = 2 * this.profile.bounce * Math.sqrt(k);
    // Fixed small steps: a stiff spring with a long step would explode (elastic.ts).
    this.clock += Math.min(dt, 0.1);
    while (this.clock >= ELASTIC_STEP) {
      this.clock -= ELASTIC_STEP;
      for (const c of CHANNELS) {
        this.vel[c] += (-k * this.pose[c] - damping * this.vel[c]) * ELASTIC_STEP;
        this.pose[c] += this.vel[c] * ELASTIC_STEP;
      }
    }
  }
}
