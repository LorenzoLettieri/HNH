// The shovel swing on screen (the simulation side is in src/sim/kick.ts):
// an overhead BONK, cartoon style.
//
// The model (public/models/shovel.glb, made by tools/blender/shovel.py) has
// its origin on the D-grip, where the hand holds it, and the shaft along -Z.
// We never show the hand: the grip stays BELOW the bottom edge of the screen
// and only the shaft and the blade come into view. An old trick (many
// shooters crop melee arms the same way): no arm to pose, and the eye reads
// the blow from the blade anyway.
//
// Four phases, each with the easing that "sells" it (an easing is a curve
// that maps 0..1 time to 0..1 progress: same idea as CSS's ease-in/ease-out):
//   1. RAISE: it's already over your head, out of view (the shaft pointing
//      up and back), and it creeps a little further back: the anticipation
//      of a cartoon blow. Nothing on screen yet: swinging it up IN FRONT of
//      the camera would sweep a huge shaft across your face.
//   2. STRIKE: down onto the target, ease-IN (u³): slow at the top, fastest
//      at the very end. The impact comes at full speed, exactly when the
//      simulation lands the hit (tuning.shovelWindup after the press).
//   3. BOING: it stops dead and bounces back up on a damped spring, with the
//      blade quivering around the shaft. The comic part. A damped
//      oscillation is A·e^(-k·t)·sin(ω·t): a sine whose amplitude decays.
//   4. DROP: down out of view.
//
// Rotation order 'YXZ': first turn left/right (yaw), then tilt the shaft up
// (pitch), then roll the blade around the shaft. The same order as an FPS
// camera, and for the same reason: each angle means one clear thing.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import { smoothstep } from './elastic';
import { loadGunModel } from './gunModel';

/** Pose and timing of the bonk. Camera space (x right, y up, -z forward); angles in radians. */
export const shovelSettings = {
  /**
   * The grip, below the bottom edge of the view (out of sight), left of
   * center and at arm's length: closer to the eye, the shaft would fill the
   * screen as it goes past.
   */
  gripX: -0.12,
  gripY: -0.45,
  gripZ: -0.3,
  /** Shaft angle raised high (π/2 = straight up: the blade above your head, out of view). */
  raisedPitch: 1.9,
  /** How much further back it creeps while raised (the anticipation), radians. */
  windBack: 0.25,
  /** Shaft angle at the impact: the blade just below the crosshair. */
  impactPitch: 0.5,
  /** Turned a little to the right: from the grip on the left, the blade lands in the middle. */
  yaw: -0.15,
  /** Blade roll: π = the flat face looks down, so it's the FACE that slaps the enemy. */
  roll: Math.PI,
  /** Fraction of the wind-up spent in the anticipation (the rest is the strike). */
  raiseShare: 0.4,
  /** How far it bounces back up after the impact, radians... */
  boingAmount: 0.35,
  /** ...how fast it wobbles (rad/s) and how fast the wobble dies out (1/s). */
  boingFrequency: 38,
  boingDecay: 11,
  /** Blade quiver around the shaft, radians (same spring). */
  quiver: 0.25,
  /** Seconds it stays out wobbling before it drops. */
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

export function createShovelView(): ShovelView {
  const s = shovelSettings;
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  root.visible = false;
  root.add(loadGunModel('shovel.glb'));
  let time = Infinity; // seconds since the swing started

  return {
    root,
    play() {
      time = 0;
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

      let pitch: number;
      let drop = 0; // meters below the rest position (0 = out, HIDDEN_DROP = gone)
      let roll = s.roll;
      const top = s.raisedPitch + s.windBack;
      if (time < raised) {
        // 1. RAISE: over your head, creeping back (ease-out: it slows down and hangs there).
        pitch = s.raisedPitch + s.windBack * smoothstep(time / raised);
      } else if (time < impact) {
        // 2. STRIKE: ease-in, u³. Its slope is 0 at the start and steepest at u = 1.
        const u = (time - raised) / (impact - raised);
        pitch = top + (s.impactPitch - top) * u * u * u;
      } else {
        // 3. BOING: |sin| so it only bounces UP off the target (it can't go through it).
        const t = time - impact;
        const decay = Math.exp(-s.boingDecay * t);
        pitch = s.impactPitch + s.boingAmount * decay * Math.abs(Math.sin(s.boingFrequency * t));
        roll += s.quiver * decay * Math.sin(s.boingFrequency * 1.3 * t);
        // 4. DROP.
        if (time > dropStart) drop = HIDDEN_DROP * smoothstep((time - dropStart) / s.dropTime);
      }
      root.position.set(s.gripX, s.gripY - drop, s.gripZ);
      root.rotation.set(pitch, s.yaw, roll);
      return 1 - drop / HIDDEN_DROP;
    },
  };
}
