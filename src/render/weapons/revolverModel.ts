// The revolver in your hand: public/models/revolver.glb, our own model,
// started from "Revolver" by Quaternius (brown grip, cylinder and hammer as
// separate parts). It's already in the viewmodel's conventions: barrel along
// -Z, meters, origin = the right hand on the grip, so it loads as is.
import * as THREE from 'three';
import { loadGunModel } from './gunModel';

export interface RevolverModel {
  root: THREE.Group;
  /** The rotating cylinder (drum): turns 60° per shot, around its own Z axis. */
  cylinder: THREE.Object3D;
  /** The hammer: modeled cocked; a positive rotation.x drops it forward (fired). */
  hammer: THREE.Object3D;
  /** Where the muzzle flash appears (barrel tip), in root coordinates. */
  muzzle: THREE.Vector3;
}

export function createRevolverModel(): RevolverModel {
  // Until the file has loaded, the animations move these empty stand-ins:
  // then the real parts take their place (the code keeps working either way).
  const model: RevolverModel = {
    root: new THREE.Group(),
    cylinder: new THREE.Object3D(),
    hammer: new THREE.Object3D(),
    muzzle: new THREE.Vector3(0, 0.044, -0.245),
  };
  model.root.add(
    loadGunModel({ file: 'revolver.glb' }, (gltf) => {
      model.cylinder = gltf.getObjectByName('cylinder') ?? model.cylinder;
      model.hammer = gltf.getObjectByName('hammer') ?? model.hammer;
    }),
  );
  return model;
}
