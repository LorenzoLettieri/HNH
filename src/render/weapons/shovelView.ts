// The shovel swing on screen (the simulation side is in src/sim/kick.ts):
// an overhead BONK, cartoon style, but with weight.
//
// The model (public/models/shovel.glb, made by tools/blender/shovel.py) has
// its origin on the D-grip, where the hand holds it, and the shaft along -Z.
// We never show the hand: the grip stays BELOW the bottom edge of the screen
// and only the shaft and the blade come into view. An old trick (many
// shooters crop melee arms the same way): no arm to pose, and the eye reads
// the blow from the blade anyway.
//
// What makes a motion look "artificial", and what we do about it:
// - Everything turning around a FIXED pivot looks like a clock hand. A real
//   person moves the arms too: here the grip rises and pulls back during the
//   wind-up, then pushes down and forward with the blow (the arms extend).
// - Perfectly straight paths look mechanical: the blade comes down on a
//   DIAGONAL, from up-left to the middle (yaw changes during the strike).
// - A formula for the bounce (a sine) repeats exactly. After the impact we
//   switch to a tiny PHYSICS simulation instead: the shaft angle has a
//   velocity, "gravity" pulls it back onto the target, and every time it
//   touches it the velocity flips and loses part of itself (the coefficient
//   of RESTITUTION, like a ball: 0 = it sticks, 1 = it bounces forever). The
//   bounces get lower AND quicker, the way real ones do. The blade's quiver
//   is a damped spring kicked by each bounce.
// - Two identical swings in a row give the trick away: each swing gets
//   small random variations (angle, roll, bounciness). Cosmetic only: the
//   simulation, the one that decides the hit, isn't touched.
//
// The downswing itself stays scripted (keyframes in time), because it must
// land exactly when the simulation lands the hit: tuning.shovelWindup after
// the press. Its easing is ease-IN (u³: slow at the top, fastest at the very
// end), so the blade arrives at full speed. Physics takes over from there,
// starting from the speed the script had at the impact.
//
// Rotation order 'YXZ': first turn left/right (yaw), then tilt the shaft up
// (pitch), then roll the blade around the shaft. The same order as an FPS
// camera, and for the same reason: each angle means one clear thing.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import { ELASTIC_STEP, smoothstep } from './elastic';
import { loadGunModel } from './gunModel';

/** Pose and timing of the bonk. Camera space (x right, y up, -z forward); angles in radians. */
export const shovelSettings = {
  /**
   * The grip at the impact, below the bottom edge of the view (out of
   * sight), left of center and at arm's length: closer to the eye, the shaft
   * would fill the screen as it goes past.
   */
  gripX: -0.12,
  gripY: -0.45,
  gripZ: -0.3,
  /** Where the grip is during the wind-up, relative to the impact position, meters: up, back, a bit left. */
  windGripX: -0.05,
  windGripY: 0.1,
  windGripZ: 0.12,
  /** Shaft angle raised high (π/2 = straight up: the blade above your head, out of view). */
  raisedPitch: 1.9,
  /** How much further back it creeps while raised (the anticipation), radians. */
  windBack: 0.25,
  /** Shaft angle at the impact: the blade just below the crosshair. */
  impactPitch: 0.5,
  /** Shaft turned left at the top of the swing (the diagonal: it comes down from up-left)... */
  windYaw: 0.35,
  /** ...and at the impact, a little to the right: from the grip on the left, the blade lands in the middle. */
  yaw: -0.15,
  /** Blade roll: π = the flat face looks down, so it's the FACE that slaps the enemy. */
  roll: Math.PI,
  /** Fraction of the wind-up spent in the anticipation (the rest is the strike). */
  raiseShare: 0.4,
  /** After the impact: how much bounce is left (0 = it sticks, 1 = it bounces forever). */
  restitution: 0.32,
  /** The pull back onto the target (the weight of the shovel and your arms), rad/s². Higher = lower, quicker bounces. */
  gravity: 450,
  /**
   * Blade quiver around the shaft: how much each bounce kicks it (quiver
   * speed per unit of bounce speed), its stiffness (1/s²) and damping (1/s).
   */
  quiverKick: 0.17,
  quiverStiffness: 1800,
  quiverDamping: 14,
  /** Random variation from swing to swing (fraction: 0.15 = ±15%). */
  variation: 0.15,
  /** Seconds it stays out bouncing before it drops. */
  holdTime: 0.2,
  /** Seconds to drop back out of view. */
  dropTime: 0.18,
};

export interface ShovelView {
  /** Goes in the viewmodel scene (not in the gun's holder: the gun's sway doesn't shake it). */
  root: THREE.Group;
  /** A swing starts now. */
  play(): void;
  /** Advance the animation. Returns how "out" the swing is, 0..1 (to move the gun aside). */
  update(dt: number): number;
}

/** Below the screen: how far down the grip goes when the shovel is put away, meters. */
const HIDDEN_DROP = 0.4;

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
  let yawOffset = 0;
  let rollOffset = 0;
  let bounciness = s.restitution;

  // The physics after the impact: the shaft angle ABOVE the target and its
  // speed, the blade's quiver and its speed, and the time not yet simulated.
  let bounced = false; // physics started (the impact happened)
  let lift = 0; // radians above impactPitch (never below: the target is there)
  let liftVel = 0;
  let quiver = 0;
  let quiverVel = 0;
  let pending = 0;

  /** One fixed step of the bounce: semi-implicit Euler (velocity first, then position), like elastic.ts. */
  function stepBounce(h: number): void {
    liftVel -= s.gravity * h;
    lift += liftVel * h;
    if (lift < 0) {
      // Touched the target: flip the speed, keep only part of it. Below a
      // tiny speed it just rests there (otherwise it would buzz forever).
      lift = 0;
      const speed = -liftVel;
      liftVel = speed > 1 ? speed * bounciness : 0;
      // Each knock shakes the blade, harder for a harder knock, either way.
      quiverVel += s.quiverKick * speed * (Math.random() < 0.5 ? -1 : 1);
    }
    quiverVel += (-s.quiverStiffness * quiver - s.quiverDamping * quiverVel) * h;
    quiver += quiverVel * h;
  }

  return {
    root,
    play() {
      time = 0;
      bounced = false;
      pending = 0;
      lift = liftVel = quiver = quiverVel = 0;
      yawOffset = 0.12 * wobble() * (s.variation / 0.15);
      rollOffset = 0.2 * wobble() * (s.variation / 0.15);
      bounciness = s.restitution * (1 + s.variation * wobble());
    },
    update(dt) {
      time += dt;
      // Phase boundaries, in seconds (read every frame: the debug panel can change them).
      const impact = tuning.shovelWindup;
      const raised = impact * s.raiseShare;
      const dropStart = impact + s.holdTime;
      const end = dropStart + s.dropTime;
      root.visible = time < end;
      if (!root.visible) return 0;

      const top = s.raisedPitch + s.windBack;
      let pitch: number;
      let yaw = s.yaw + yawOffset;
      let arms = 0; // 1 = the grip in the wind-up position, 0 = at the impact position
      let drop = 0; // meters below the rest position (0 = out, HIDDEN_DROP = gone)
      if (time < raised) {
        // 1. RAISE: over your head, creeping back (ease-out: it slows down and hangs there).
        pitch = s.raisedPitch + s.windBack * smoothstep(time / raised);
        yaw = s.windYaw + yawOffset;
        arms = 1;
      } else if (time < impact) {
        // 2. STRIKE: ease-in, u³. Its slope is 0 at the start and steepest at u = 1.
        const u = (time - raised) / (impact - raised);
        pitch = top + (s.impactPitch - top) * u * u * u;
        // The diagonal and the arms follow a gentler curve: they lead, the blade lags behind.
        const k = smoothstep(u);
        yaw = s.windYaw + (s.yaw - s.windYaw) * k + yawOffset;
        arms = 1 - k;
      } else {
        // 3. BOUNCE: physics, from the speed the strike had at the impact.
        if (!bounced) {
          bounced = true;
          // d/dt of top + (impact - top)·u³ at u = 1: 3·(impact - top) / strike duration.
          const strikeSpeed = (3 * (top - s.impactPitch)) / Math.max(0.01, impact - raised);
          lift = 0;
          liftVel = -strikeSpeed; // going down into the target: the first step bounces it
          pending = time - impact; // the part of this frame after the impact
        } else {
          pending += dt;
        }
        // Fixed steps (a stiff spring with a long step "explodes"; see elastic.ts).
        while (pending >= ELASTIC_STEP) {
          stepBounce(ELASTIC_STEP);
          pending -= ELASTIC_STEP;
        }
        pitch = s.impactPitch + lift;
        // 4. DROP.
        if (time > dropStart) drop = HIDDEN_DROP * smoothstep((time - dropStart) / s.dropTime);
      }
      // The arms bounce a little with the blade (the shock goes back into your hands).
      root.position.set(
        s.gripX + s.windGripX * arms,
        s.gripY + s.windGripY * arms + lift * 0.04 - drop,
        s.gripZ + s.windGripZ * arms + lift * 0.03,
      );
      root.rotation.set(pitch, yaw, s.roll + rollOffset + quiver);
      return 1 - drop / HIDDEN_DROP;
    },
  };
}
