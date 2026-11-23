// The dynamite launcher in your hand (public/models/dynamiteLauncher.glb,
// made by tools/blender/dynamite_launcher.py). For now it only HOLDS it: the
// animations (the drum turning, the reload) come next.
//
// A heavy gun held with TWO hands. The model is in the viewmodel's
// conventions (barrel along -Z, origin = the right hand on the wrist of the
// stock) and it was built around the carbine's hands (rifleArms.glb): the
// right one on the wrist, the left one under the walnut fore-end. So the
// carbine's arms hold it as they are, children of the gun like on the
// carbine, and it's held in the carbine's hip pose (the arms are posed for it).
//
// The moving parts, found by name (see the top of the Blender script):
//   drum       origin on the drum's axis: rotation.z turns it (three.js -Z = the barrel)
//   stick_0..4 the sticks in the chambers, children of the drum, origin at
//              their back end (stick_0 is the one in front of the barrel)
//   muzzle     an empty at the mouth: where the flash goes
import * as THREE from 'three';
import { loadGunModel } from './gunModel';
import { createRifleHands } from './hands';

/**
 * Where the muzzle is, in the model's coordinates: the same numbers as the
 * Blender script (BARREL_END + 1 cm, BARREL_Z), converted to three.js axes
 * (Blender y → three.js −z). Used until the file has loaded; then the
 * `muzzle` empty of the file wins.
 */
const MUZZLE = new THREE.Vector3(0, 0.081, -0.65);

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
  // The carbine's arms: the launcher was built around their hands.
  const hands = createRifleHands();
  root.add(hands.right, hands.left);
  return { root, muzzle };
}
