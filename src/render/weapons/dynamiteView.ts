// The dynamite launcher in your hand (public/models/dynamiteLauncher.glb,
// made by tools/blender/dynamite_launcher.py). For now it only HOLDS it: the
// animations (the drum turning, the reload) come next.
//
// The model is in the viewmodel's conventions (barrel along -Z, origin = the
// right hand on the grip) and its grip has the same slant and thickness as
// the revolver's: so the revolver's right arm (Arm_R in arms.glb) holds it
// as it is, added as a child of the gun like on the revolver.
//
// The moving parts, found by name (see the top of the Blender script):
//   drum       origin on the drum's axis: rotation.z turns it (three.js -Z = the barrel)
//   stick_0..4 the sticks in the chambers, children of the drum, origin at
//              their back end (stick_0 is the one in front of the barrel)
//   muzzle     an empty at the mouth: where the flash goes
import * as THREE from 'three';
import { loadGunModel } from './gunModel';
import { createHands } from './hands';

/**
 * Where the muzzle is, in the model's coordinates: the same numbers as the
 * Blender script (BARREL_END + 1 cm, BARREL_Z), converted to three.js axes
 * (Blender y → three.js −z). Used until the file has loaded; then the
 * `muzzle` empty of the file wins.
 */
const MUZZLE = new THREE.Vector3(0, 0.058, -0.37);

export interface DynamiteView {
  root: THREE.Group;
  /** Where the flash goes (model coordinates). */
  muzzle: THREE.Vector3;
}

export function createDynamiteView(): DynamiteView {
  const muzzle = MUZZLE.clone();
  const root = loadGunModel('dynamiteLauncher.glb', (model) => {
    const m = model.getObjectByName('muzzle');
    if (m) muzzle.copy(m.position);
  });
  // The revolver's right arm: the launcher's grip was built to fit its hand.
  root.add(createHands().right);
  return { root, muzzle };
}
