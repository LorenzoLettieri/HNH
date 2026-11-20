// The shovel swing on screen (the simulation side is in src/sim/kick.ts).
//
// The model (public/models/shovel.glb, made by tools/blender/shovel.py) has
// its origin on the D-grip, where the hand holds it, and the shaft along -Z.
// We never show the hand: the grip stays BELOW the bottom-left edge of the
// screen and only the shaft and the blade sweep across the view. An old
// trick (many shooters crop melee arms the same way): no arm to pose, and
// the eye reads the swing from the blade anyway.
//
// The swing is a few KEYFRAMES of the grip's pose (position + rotation, in
// the viewmodel camera's space), blended with smoothstep (poseAt, elastic.ts).
// The subtle part is WHEN the blade must hit: at the moment the simulation
// lands the blow (tuning.shovelWindup after the press). Smoothstep is slow
// at both ends of a segment and fastest exactly in the MIDDLE, so the
// "cocked" key and the "follow-through" key are placed symmetrically around
// the impact: the blade crosses the center of the screen at full speed
// right when the hit happens, instead of easing in and stopping there.
//
// Rotation order 'YXZ': first turn left/right (yaw), then tilt the shaft up
// (pitch), then roll the blade around the shaft. The same order as an FPS
// camera, and for the same reason: each angle means one clear thing.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import { poseAt, ZERO_POSE, type GunPose } from './elastic';
import { loadGunModel } from './gunModel';

/** Where the grip sits when the swing is "out", camera space (x right, y up, -z forward). */
export const shovelSettings = {
  /** The grip, below the bottom-left corner of the view (out of sight). */
  gripX: -0.12,
  gripY: -0.42,
  gripZ: -0.12,
  /** How far around the swing starts (left) and ends (right), radians. */
  cockYaw: 1.0,
  followYaw: -1.1,
  /** How much the shaft points up, radians: brings the blade into view. */
  pitch: 0.75,
  /** Blade roll around the shaft, radians: its flat face leads the swing (a "BONK"). */
  roll: -1.3,
  /** Seconds it takes to come in from below before the cocked pose (at most: shorter if the wind-up is). */
  raiseTime: 0.06,
  /** Seconds to drop back out of view after the follow-through. */
  dropTime: 0.22,
};

export interface ShovelView {
  /** Goes in the viewmodel scene (not in the gun's holder: the gun's sway doesn't shake it). */
  root: THREE.Group;
  /** A swing starts now. */
  play(): void;
  /** Advance the animation. Returns how "out" the swing is, 0..1 (to move the gun aside). */
  update(dt: number): number;
}

export function createShovelView(): ShovelView {
  const s = shovelSettings;
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  root.visible = false;
  root.add(loadGunModel('shovel.glb'));
  let time = Infinity; // seconds since the swing started

  /**
   * The keyframes for this swing, built from the CURRENT tuning (the debug
   * panel can change the wind-up): times in seconds, poses as absolute
   * angles plus a drop below the screen in y.
   */
  function keys(): [number, GunPose][] {
    const impact = tuning.shovelWindup;
    // Symmetric around the impact (see the top of the file). Half of the
    // sweep before, half after: the cocked key can't come before t = 0.
    const half = Math.max(0.05, Math.min(impact, 0.1));
    const cocked = Math.max(0, impact - half);
    const follow = impact + half;
    const hidden = (yaw: number): GunPose => ({ ...ZERO_POSE, y: -0.35, yaw, pitch: s.pitch - 0.6, roll: s.roll });
    const out = (yaw: number): GunPose => ({ ...ZERO_POSE, yaw, pitch: s.pitch, roll: s.roll });
    const k: [number, GunPose][] = [];
    // Coming in from below (only if there's time before the cocked pose).
    if (cocked > 0) k.push([Math.max(0, cocked - s.raiseTime), hidden(s.cockYaw)]);
    k.push([cocked, out(s.cockYaw)], [follow, out(s.followYaw)], [follow + s.dropTime, hidden(s.followYaw - 0.3)]);
    return k;
  }

  return {
    root,
    play() {
      time = 0;
    },
    update(dt) {
      time += dt;
      const k = keys();
      const end = k[k.length - 1][0];
      root.visible = time < end;
      if (!root.visible) return 0;
      // poseAt works on a 0..1 timeline: our key times divided by the end.
      const pose = poseAt(
        k.map(([t, p]) => [t / end, p]),
        time / end,
      );
      // Before the first key (coming in from below), poseAt has nothing yet: start hidden.
      const p = time < k[0][0] ? k[0][1] : pose;
      root.position.set(s.gripX, s.gripY + p.y, s.gripZ);
      root.rotation.set(p.pitch, p.yaw, p.roll);
      // How "out" it is: 1 between the cocked and the follow-through poses, fading at the ends.
      return Math.max(0, Math.min(1, 1 + p.y / 0.35));
    },
  };
}
