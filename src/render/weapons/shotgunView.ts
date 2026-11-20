// The double-barrel shotgun in your hands: "Shotgun Double Barrel" by
// CreativeTrio (public/models/doubleBarrel.glb, see CREDITS.md), fitted to
// the viewmodel by gunModel.ts, plus the hands.
//
// In the file the gun lies on its side: barrels along -Z (good), but its
// "down" (trigger, stock) is +X. A roll of -90° around Z turns +X into -Y.
// It's ~2 units long: scaled to ~1.1 m, a real full-length double barrel.
//
// The model is a single mesh: unlike the old Blender gun (tools/blender/
// shotgun.py, which had hinge, hammers and shells as separate parts), the
// barrels can't break open. The reload is just the gun swinging across.
// Everything is cosmetic: ammo and timing are decided by the simulation.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import { loadGunModel, type GunFit } from './gunModel';
import { createHands } from './hands';

export const SHOTGUN_FIT: GunFit = {
  file: 'doubleBarrel.glb',
  rotation: [0, 0, -Math.PI / 2],
  scale: 0.55,
  // Puts the wrist of the stock (behind the trigger) where the right hand holds it.
  position: [-0.013, 0.069, -0.12],
};

/** Where the arms hold this gun (rough: the hands will be redone for the new models). */
export const shotgunArmSettings = {
  /** Turn of the right arm around X, radians (negative = fist leans forward, like this grip). */
  rightTilt: -0.3,
  rightScale: 1.1,
  /** Left palm under the fore-end, in the gun's coordinates. */
  leftX: -0.035,
  leftY: 0.03,
  leftZ: -0.3,
  leftPitch: 0,
  /** After the roll, a turn around the vertical axis sends the forearm back and down instead of to the right. */
  leftYaw: -1.0,
  leftRoll: Math.PI / 2,
};

export interface ShotgunView {
  /** Goes inside the viewmodel holder. Its origin is the right hand on the grip. */
  root: THREE.Group;
  /** Muzzle of each barrel (0 = right, 1 = left), in root coordinates. */
  muzzles: [THREE.Vector3, THREE.Vector3];
  onReload(): void;
  /** Stop any reload animation (weapon switched away). */
  cancel(): void;
  /** Advance the animations. Returns how much the gun is tilted for the reload, 0..1. */
  update(dt: number, player: PlayerState): number;
}

export function createShotgunView(): ShotgunView {
  const root = new THREE.Group();
  root.add(loadGunModel(SHOTGUN_FIT));

  // Arms: the same model as the revolver's (render/weapons/hands.ts), moved
  // to fit this gun. The right arm is modeled frozen around the REVOLVER's
  // grip, so we move the whole arm: turn it by `rightTilt`, then shift it so
  // the revolver's grip center lands on this gun's. The math: we want
  // R·p_revolver + t = p_shotgun, so t = p_shotgun − R·p_revolver.
  const a = shotgunArmSettings;
  const hands = createHands();
  hands.right.rotation.set(a.rightTilt, 0, 0);
  hands.right.scale.setScalar(a.rightScale);
  const revolverGrip = new THREE.Vector3(0, -0.028, 0.03).multiplyScalar(a.rightScale);
  const shotgunGrip = new THREE.Vector3(0.004, -0.012, 0.014);
  hands.right.position.copy(shotgunGrip).sub(revolverGrip.applyEuler(hands.right.rotation));
  // The left arm is modeled palm DOWN (for the fanning): rolled 90° the palm
  // faces right and grabs the fore-end; the yaw swings the forearm back and down.
  hands.left.position.set(a.leftX, a.leftY, a.leftZ);
  hands.left.rotation.set(a.leftPitch, a.leftYaw, a.leftRoll);
  root.add(hands.right, hands.left);

  let reloadTime = -1; // seconds since the reload started (-1 = not reloading)

  return {
    root,
    muzzles: [new THREE.Vector3(0.011, 0.077, -0.77), new THREE.Vector3(-0.003, 0.077, -0.77)],
    onReload() {
      reloadTime = 0;
    },
    cancel() {
      reloadTime = -1;
    },
    update(dt, player) {
      if (reloadTime < 0) return 0;
      reloadTime += dt;
      const t = reloadTime / tuning.shotgunReloadTime;
      // Done, or interrupted (e.g. you died): back to normal.
      if (t >= 1 || (player.reloadTicks === 0 && t < 0.9)) {
        reloadTime = -1;
        return 0;
      }
      return Math.sin(Math.PI * t); // 0 → 1 → 0: the gun tilts in, then back
    },
  };
}
