// The revolver in your hand: public/models/revolver.glb, our own model,
// started from "Revolver" by Quaternius (brown grip, moving parts added by
// us). It's already in the viewmodel's conventions: barrel along -Z, meters,
// origin = the right hand on the grip, so it loads as is. The parts:
//
//   frame              doesn't move
//   ├── hammer         modeled cocked; a positive rotation.x drops it (fired)
//   └── crane          the arm the cylinder swings out on: origin on its pivot,
//       │              an axis parallel to the barrel (rotation.z opens it)
//       └── cylinder   origin on its axis: rotation.z turns it (60° per shot)
//           └── round_0..5  the rounds in the chambers (0 = in line with the
//                           barrel), origin on the rim: they slide out along +z
import * as THREE from 'three';
import { loadGunModel } from './gunModel';

/**
 * Where the index finger goes through the trigger guard, in root coordinates
 * (measured on revolver.glb: the guard spans y −0.028…0, z −0.049…−0.029).
 * The akimbo spin reload twirls the gun around this point.
 */
const SPIN_PIVOT = new THREE.Vector3(0, -0.012, -0.04);

export interface RevolverModel {
  root: THREE.Group;
  /**
   * The gun alone, without the hand: its rotation.x twirls it round the
   * trigger finger (the akimbo reload). A PIVOT group: placed on the finger,
   * with the model inside moved back by the same amount, so rotating the
   * group rotates the model around the finger instead of around the grip.
   * (The same trick as rotating a CSS element around a transform-origin.)
   */
  spin: THREE.Group;
  crane: THREE.Object3D;
  cylinder: THREE.Object3D;
  hammer: THREE.Object3D;
  rounds: THREE.Object3D[];
  /** Where each round sits in its chamber (cylinder coordinates). */
  roundRest: THREE.Vector3[];
  /** Where the muzzle flash appears (barrel tip), in root coordinates. */
  muzzle: THREE.Vector3;
}

export function createRevolverModel(): RevolverModel {
  // Until the file has loaded, the animations move these empty stand-ins:
  // then the real parts take their place (the code keeps working either way).
  const model: RevolverModel = {
    root: new THREE.Group(),
    spin: new THREE.Group(),
    crane: new THREE.Object3D(),
    cylinder: new THREE.Object3D(),
    hammer: new THREE.Object3D(),
    rounds: [],
    roundRest: [],
    muzzle: new THREE.Vector3(0, 0.044, -0.245),
  };
  const body = loadGunModel('revolver.glb', (gltf) => {
    model.crane = gltf.getObjectByName('crane') ?? model.crane;
    model.cylinder = gltf.getObjectByName('cylinder') ?? model.cylinder;
    model.hammer = gltf.getObjectByName('hammer') ?? model.hammer;
    for (let i = 0; i < 6; i++) {
      const round = gltf.getObjectByName(`round_${i}`);
      if (!round) continue;
      model.rounds.push(round);
      model.roundRest.push(round.position.clone());
    }
  });
  // root → spin (on the finger) → body (moved back by the same amount): at
  // rest everything is exactly where it was; spin.rotation.x turns it round the finger.
  model.spin.position.copy(SPIN_PIVOT);
  body.position.copy(SPIN_PIVOT).negate();
  model.spin.add(body);
  model.root.add(model.spin);
  return model;
}
