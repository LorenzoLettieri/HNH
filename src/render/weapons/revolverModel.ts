// The revolver in your hand: "Revolver" by Quaternius (public/models/revolver.glb,
// see CREDITS.md), fitted to the viewmodel by gunModel.ts.
// In the file the barrel points along +X, up is +Y and the gun is ~2 units
// long: we turn it 90° around the vertical axis (+X → -Z) and scale it to
// ~30 cm. The model is a single mesh: the cylinder and the hammer can't move
// on their own (the procedural revolver could), so recoil and reload move
// the whole gun.
import * as THREE from 'three';
import { loadGunModel, type GunFit } from './gunModel';

export const REVOLVER_FIT: GunFit = {
  file: 'revolver.glb',
  rotation: [0, Math.PI / 2, 0],
  scale: 0.151,
  // Puts the middle of the wooden grip where the right hand holds it.
  position: [0, -0.02, 0.026],
};

export interface RevolverModel {
  root: THREE.Group;
  /** Where the muzzle flash appears (barrel tip), in root coordinates. */
  muzzle: THREE.Vector3;
}

export function createRevolverModel(): RevolverModel {
  return { root: loadGunModel(REVOLVER_FIT), muzzle: new THREE.Vector3(0, 0.044, -0.245) };
}
