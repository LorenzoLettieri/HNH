// The shovel swing on screen (the simulation side is in src/sim/kick.ts):
// a GOLF SWING, CoD style. The shovel takes both hands, so first the gun goes
// down out of view (gunAwayAt below, used by viewmodel.ts), then the shovel
// comes round from behind your right shoulder, sweeps LOW across the middle of
// the screen, where it hits, and follows through up and out to the left. Then
// the gun comes back up, drawn like a weapon switch.
//
// The model (public/models/shovel.glb, made by tools/blender/shovel.py) has
// its origin on the D-grip, where the hands hold it, and the shaft along -Z;
// the blade is a flat plate across X (its face looks along ±Y). We never show
// the hands: the grip stays BELOW the bottom edge of the screen, the way a
// golfer's hands are low in front of the belly, and only the shaft and the
// blade come into view. (An old trick: no arms to pose, and the eye reads the
// blow from the blade anyway.)
//
// THE PATH: one number, `s`, says where the swing is: -1 = top of the
// backswing (behind your right shoulder), 0 = the impact (in front of you,
// low), +1 = the end of the follow-through (up on your left). Everything is a
// function of s:
// - yaw (left/right) grows linearly with s: the sweep across the screen;
// - pitch (up/down) grows with s²: a parabola, lowest at s = 0, so the blade
//   comes DOWN, goes through the target flat and sideways, and rises again:
//   the U of a golf swing, seen from inside;
// - the hands slide from right to left (they cross your body) and rise and
//   come back beside your head at both ends.
// Then only TIME → s is animated, like an "easing" in CSS: the backswing
// creeps back (anticipation, off screen while the gun goes down), the
// downswing accelerates (fastest at the impact, which lands exactly when the
// simulation hits: tuning.shovelWindup), the follow-through slows down
// (ease-out). Both curves are GENTLE on purpose: the blade is only on screen
// for the stretch around the impact, so that stretch must not be the fastest
// one by far. The speed drops at the impact (the downswing arrives faster than
// the follow-through leaves): the blade meets resistance, and you see it.
//
// Two identical swings in a row give the trick away: each swing gets small
// random variations (height, sweep, blade roll). Cosmetic only.
//
// HELD (key 5: the shovel in your hands instead of a gun): it rests on your
// right, the grip still below the screen, the shaft rising across the right
// side and the blade up in the corner, its face toward you (`held*` below).
// The swing then starts FROM there: during the backswing it's lifted away up
// and back (a blend from the held pose to the swing's path, so nothing pops),
// and after the follow-through it comes back up from below into the held
// pose (`returnTime`), like a gun after a switch.
//
// Rotation order 'YXZ': first turn left/right (yaw), then tilt the shaft up
// (pitch), then roll the blade around the shaft. The same order as an FPS
// camera, and for the same reason: each angle means one clear thing.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import { ELASTIC_STEP, smoothstep, type GunPose } from './elastic';
import { loadGunModel } from './gunModel';

/** Pose and timing of the swing. Camera space (x right, y up, -z forward); angles in radians. */
export const shovelSettings = {
  /** Seconds for the gun to go down out of view (it must be gone before the shovel shows up). */
  gunDownTime: 0.1,
  /** How far the gun drops (meters) and dips its muzzle (radians) going away. */
  gunDownDrop: 0.3,
  gunDownTilt: 0.7,
  /** The grip at the impact: below the bottom edge of the view, at arm's length. */
  gripX: 0.02,
  gripY: -0.42,
  gripZ: -0.3,
  /**
   * How far the hands slide sideways over the whole swing (right → left), and
   * how much they rise and come BACK at its two ends, meters. Coming back
   * matters: with the grip out in front, a shaft pointing behind you passes
   * right beside your eye and crosses the whole screen. With the hands beside
   * your head, like a golfer at the top of the backswing, it stays out of view.
   */
  gripSwing: 0.35,
  gripRise: 0.25,
  gripBack: 0.3,
  /** Top of the backswing: shaft turned right and back (beyond -π/2 = behind you), and raised. */
  backYaw: -2.0,
  backPitch: 1.2,
  /** At the impact: almost straight ahead, the blade a little below the crosshair. */
  impactYaw: 0.08,
  impactPitch: 0.35,
  /** End of the follow-through: up on the left, out of view. */
  throughYaw: 2.0,
  throughPitch: 1.4,
  /**
   * Blade roll: 0 = the flat face looks up, π/2 = it looks LEFT, the way it's
   * going. π/2 would be "right" (the FACE whacks the enemy) but from your eye
   * the blade is then seen edge-on, a thin line. In between: the face mostly
   * up toward you and leading a little. Readability beats realism.
   */
  roll: 0.6,
  /** The face opens on the backswing and closes on the follow-through (radians per unit of s), like a golf club. */
  rollTwist: 0.35,
  /** How much further back the backswing creeps before the downswing (in units of s: the anticipation). */
  windBack: 0.1,
  /** Fraction of the wind-up spent on the backswing (the gun goes down meanwhile; the rest is the downswing). */
  backShare: 0.3,
  /**
   * The two easings (exponents). Downswing: s grows like u^strikeEase (1 =
   * constant speed, 3 = everything in the last instant). Follow-through:
   * 1 - (1 - v)^throughEase (1 = constant speed, higher = it slows down sooner).
   * LOW on purpose: the blade is only on screen near the impact, and with
   * steep curves that's exactly where it's fastest (it was visible ~30 ms,
   * two frames). These keep it on screen ~150 ms.
   */
  strikeEase: 1.5,
  throughEase: 1.4,
  /** Seconds of follow-through after the impact (until it's out of view on the left: ~half of it). */
  throughTime: 0.3,
  /**
   * Blade quiver around the shaft after the impact: the kick it gets (rad/s),
   * stiffness (1/s²), damping (1/s). A damped spring, like elastic.ts.
   */
  quiverKick: 9,
  quiverStiffness: 1800,
  quiverDamping: 18,
  /** Random variation from swing to swing (fraction: 0.15 = ±15%). */
  variation: 0.15,
  /** HELD in your hands (key 5): the grip, and the shaft's angles (blade up on the right, its face toward you). */
  heldX: 0.2,
  heldY: -0.42,
  heldZ: -0.2,
  heldPitch: 1.05,
  heldYaw: -0.45,
  heldRoll: 1.0,
  /** Seconds for it to come back up into the held pose after a swing. */
  returnTime: 0.22,
};

export interface ShovelView {
  /** Goes in the viewmodel scene (not in the gun's holder: the gun's sway doesn't shake it). */
  root: THREE.Group;
  /** A swing starts now. */
  play(): void;
  /**
   * Advance the animation. `held` = the shovel is in your hands (key 5):
   * between swings it rests in the held pose, moved by `offset` (the
   * viewmodel's sway, bob and draw).
   */
  update(dt: number, held: boolean, offset: GunPose): void;
}

/**
 * How far the gun is put away, `t` seconds after the press: 0 = in your hands,
 * 1 = gone below the screen. It goes down with an ease-in (u²: it drops, it
 * doesn't glide), stays away during the swing, and at `gunBack` (the melee
 * weapon's: tuning.shovelGunBack, lassoGunBack) the viewmodel draws it back
 * like a weapon switch (from then on: 0). The lasso uses it too.
 */
export function gunAwayAt(t: number, gunBack: number): number {
  if (t >= gunBack) return 0;
  const u = Math.min(1, t / Math.max(0.01, shovelSettings.gunDownTime));
  return u * u;
}

/** A random number in [-1, 1]. Cosmetic randomness: Math.random is fine here (the simulation has its own, seeded). */
function wobble(): number {
  return Math.random() * 2 - 1;
}

export function createShovelView(): ShovelView {
  const s = shovelSettings;
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  root.visible = false;
  root.add(loadGunModel('shovel.glb'));
  let time = Infinity; // seconds since the swing started

  // This swing's variations (rolled in play()).
  let pitchOffset = 0;
  let yawScale = 1;
  let rollOffset = 0;

  // The blade's quiver after the impact (a damped spring stepped at fixed steps).
  let hit = false;
  let quiver = 0;
  let quiverVel = 0;
  let pending = 0;

  return {
    root,
    play() {
      time = 0;
      hit = false;
      quiver = quiverVel = pending = 0;
      const k = s.variation / 0.15;
      pitchOffset = 0.08 * wobble() * k;
      yawScale = 1 + 0.1 * wobble() * k;
      rollOffset = 0.2 * wobble() * k;
    },
    update(dt, held, offset) {
      time += dt;
      // Phase boundaries, in seconds (read every frame: the debug panel can change them).
      const impact = tuning.shovelWindup;
      const back = impact * s.backShare;
      const end = impact + s.throughTime;
      root.visible = time < end || held;
      if (!root.visible) return;
      if (time >= end) {
        // Held, between swings: the rest pose, coming back up from below after a swing.
        // (time = Infinity: no swing yet. Ease-out: it rises fast and settles.)
        const r = time === Infinity ? 1 : Math.min(1, (time - end) / s.returnTime);
        const k = 1 - Math.pow(1 - r, 3);
        root.position.set(s.heldX + offset.x, s.heldY + offset.y - 0.35 * (1 - k), s.heldZ + offset.z);
        root.rotation.set(s.heldPitch + offset.pitch - 0.7 * (1 - k), s.heldYaw + offset.yaw, s.heldRoll + offset.roll);
        return;
      }

      // 1. TIME → s (where along the swing).
      const top = -1 - s.windBack;
      let swing: number;
      if (time < back) {
        // Backswing: creeps from the top of the backswing a bit further back (ease-out: it hangs there).
        swing = -1 - s.windBack * smoothstep(time / back);
      } else if (time < impact) {
        // Downswing: ease-in, u^strikeEase. Slow at the start, fastest at the impact.
        const u = (time - back) / (impact - back);
        swing = top + (0 - top) * Math.pow(u, s.strikeEase);
      } else {
        // Follow-through: ease-out, 1 - (1 - v)^throughEase. It starts SLOWER
        // than the downswing arrived: the speed drops at the impact, the blade
        // "meets the enemy" (a hitch, like hitting something heavy).
        const v = (time - impact) / s.throughTime;
        swing = 1 - Math.pow(1 - v, s.throughEase);
        // The impact shakes the blade (once), then the quiver rings down at fixed steps.
        if (!hit) {
          hit = true;
          quiverVel = s.quiverKick * (Math.random() < 0.5 ? -1 : 1);
          pending = time - impact;
        } else {
          pending += dt;
        }
        while (pending >= ELASTIC_STEP) {
          quiverVel += (-s.quiverStiffness * quiver - s.quiverDamping * quiverVel) * ELASTIC_STEP;
          quiver += quiverVel * ELASTIC_STEP;
          pending -= ELASTIC_STEP;
        }
      }

      // 2. s → the pose. Yaw: linear on each side of the impact (the two ends can differ).
      // Pitch: a parabola in s, lowest at the impact.
      const side = swing < 0 ? -swing : swing; // 0 at the impact, 1 at either end
      const endYaw = swing < 0 ? s.backYaw : s.throughYaw;
      const endPitch = swing < 0 ? s.backPitch : s.throughPitch;
      const yaw = s.impactYaw + (endYaw - s.impactYaw) * side * yawScale;
      const pitch = s.impactPitch + pitchOffset + (endPitch - s.impactPitch) * side * side;
      const ends = side * side; // 0 at the impact, 1 at either end
      root.position.set(s.gripX - s.gripSwing * swing, s.gripY + s.gripRise * ends, s.gripZ + s.gripBack * ends);
      root.rotation.set(pitch, yaw, s.roll - s.rollTwist * swing + rollOffset + quiver);
      if (held && time < back) {
        // From the held pose, lifted away into the backswing: a blend (the
        // rotation channel by channel: fine for angles this close).
        const b = smoothstep(time / back);
        const mix = (a: number, c: number) => a + (c - a) * b;
        root.position.set(mix(s.heldX, root.position.x), mix(s.heldY, root.position.y), mix(s.heldZ, root.position.z));
        root.rotation.set(mix(s.heldPitch, root.rotation.x), mix(s.heldYaw, root.rotation.y), mix(s.heldRoll, root.rotation.z));
      }
    },
  };
}
