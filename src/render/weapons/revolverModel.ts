// Procedural revolver model (a western single-action, ~30 cm long).
// Units are meters; the barrel points along -Z, up is +Y. The origin is
// roughly where the hand holds the grip.
// Built from simple shapes like the props, but with its own materials: the
// viewmodel scene has no fog, and sharing materials between a foggy and a
// non-foggy scene would make Three.js recompile shaders back and forth.
import * as THREE from 'three';
import { brassTexture, ironTexture, postWoodTexture } from '../props/textures';

export interface RevolverModel {
  root: THREE.Group;
  /** The rotating cylinder (drum): turns 60° per shot. */
  cylinder: THREE.Mesh;
  /** The hammer: pulled back after each shot. */
  hammer: THREE.Mesh;
  /** Where the muzzle flash appears (barrel tip), in root coordinates. */
  muzzle: THREE.Vector3;
}

function mat(texture: THREE.Texture, options: THREE.MeshStandardMaterialParameters = {}) {
  // metalness 0: a "metallic" material only shows color through reflections,
  // and with nothing to reflect (no environment map) it would look black.
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0, ...options });
}

/** A cylinder lying along Z (CylinderGeometry stands along Y by default). */
function tube(radius: number, length: number, sides: number): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, length, sides);
  g.rotateX(Math.PI / 2);
  return g;
}

export function createRevolverModel(): RevolverModel {
  const root = new THREE.Group();
  const iron = mat(ironTexture(), { color: 0xd8d8e8 }); // lighter than the props: it's polished
  const darkIron = mat(ironTexture(), { color: 0x9090a0 });
  const brass = mat(brassTexture());
  const wood = mat(postWoodTexture(), { roughness: 0.9, color: 0xe0a070 });

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };

  // Barrel: 6 sides, like the octagonal barrels of old revolvers.
  add(tube(0.011, 0.17, 6), iron, 0, 0.034, -0.135);
  // Ejector rod housing, under the barrel.
  add(tube(0.006, 0.11, 6), darkIron, 0.006, 0.019, -0.11);
  // Front sight.
  add(new THREE.BoxGeometry(0.004, 0.01, 0.012), iron, 0, 0.048, -0.212);
  // Frame: the block holding everything together.
  add(new THREE.BoxGeometry(0.026, 0.045, 0.075), darkIron, 0, 0.024, -0.02);
  // Brass trigger guard and back strap.
  const guard = add(new THREE.TorusGeometry(0.016, 0.003, 4, 8, Math.PI), brass, 0, 0.0, -0.012);
  guard.rotation.set(0, Math.PI / 2, Math.PI); // half ring, hanging below the frame
  add(new THREE.BoxGeometry(0.004, 0.016, 0.004), darkIron, 0, 0.002, -0.014); // trigger

  // Cylinder (the drum with the 6 chambers): 6 sides so you can see it turn.
  const cylinder = add(tube(0.022, 0.046, 6), iron, 0, 0.026, -0.028);

  // Hammer, at the back of the frame.
  const hammer = add(new THREE.BoxGeometry(0.008, 0.026, 0.012), darkIron, 0, 0.05, 0.018);
  hammer.geometry.translate(0, 0.01, 0); // pivot at its base, so it rotates like a real one

  // Wooden grip, angled back like a "plow handle".
  const grip = add(new THREE.BoxGeometry(0.024, 0.08, 0.034), wood, 0, -0.028, 0.03);
  grip.rotation.x = 0.35;
  add(new THREE.BoxGeometry(0.026, 0.012, 0.036), brass, 0, -0.068, 0.045).rotation.x = 0.35; // butt cap

  return { root, cylinder, hammer, muzzle: new THREE.Vector3(0, 0.034, -0.225) };
}
