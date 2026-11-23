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
import { viewmodelSettings } from './viewmodel';

/**
 * Where the muzzle is, in the model's coordinates: the same numbers as the
 * Blender script (BARREL_END + 1 cm, BARREL_Z), converted to three.js axes
 * (Blender y → three.js −z). Used until the file has loaded; then the
 * `muzzle` empty of the file wins.
 */
const MUZZLE = new THREE.Vector3(0, 0.081, -0.65);

/**
 * The carbine's right hand grips the LOWER BAR of the carbine's lever, not
 * its wrist: the hole of the fist is 7.2 cm below the origin (measured on
 * the vertices of rifleArms.glb). The arm is lifted by that much, so the fist
 * closes around this gun's wrist (at the origin, as thick as the hole; the
 * Blender script has the same number: RIGHT_FIST).
 */
const FIST = new THREE.Vector3(0.003, 0.072, 0);

export interface DynamiteView {
  root: THREE.Group;
  /** Where the flash goes (model coordinates). */
  muzzle: THREE.Vector3;
  /** Call every frame: applies the right arm's turn (debug panel). */
  update(): void;
}

export function createDynamiteView(): DynamiteView {
  const muzzle = MUZZLE.clone();
  const root = loadGunModel('dynamiteLauncher.glb', (model) => {
    const m = model.getObjectByName('muzzle');
    if (m) muzzle.copy(m.position);
  });
  // The carbine's arms: the launcher was built around their hands.
  // The RIGHT arm, though, is posed to grab the carbine's lever from below:
  // lifted (FIST) so the fist wraps this wrist, then hung from a PIVOT on the
  // wrist (the origin), which can be turned (debug panel): the hand stays
  // wrapped around the wrist, only the forearm swings (the shoulder is off
  // screen anyway).
  const hands = createRifleHands();
  const fist = new THREE.Group();
  hands.right.position.copy(FIST);
  fist.add(hands.right);
  root.add(fist, hands.left);
  return {
    root,
    muzzle,
    update() {
      const s = viewmodelSettings;
      fist.rotation.set(s.dynamiteHandPitch, s.dynamiteHandYaw, s.dynamiteHandRoll);
    },
  };
}
