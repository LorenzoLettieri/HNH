// Loads a downloaded gun model (.glb) and "fits" it to the viewmodel.
//
// A model made by someone else comes with ITS conventions: which axis the
// barrel points along, which way is up, how big it is (one unit = one meter?
// one centimeter?), where its origin is. Our viewmodel expects: barrel along
// -Z, up = +Y, meters, origin = where the right hand holds the grip.
// Instead of editing the file, we wrap it in a group and correct it with a
// transform (rotation, scale, offset): the same idea as a CSS `transform` on
// an image whose size and orientation you can't change.
//
// Order of the corrections (Three.js applies them to a child as
// scale → rotation → position): first turn the model the right way, then
// shrink it, then slide it so the grip lands on the origin.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface GunFit {
  /** File name in public/models/. */
  file: string;
  /** Euler rotation (radians) that points the barrel along -Z with the top up. */
  rotation: [number, number, number];
  /** Uniform scale: model units → meters. */
  scale: number;
  /** Final offset in meters, applied after rotation and scale (puts the grip on the origin). */
  position: [number, number, number];
}

/**
 * Returns a group right away; the model is added inside it when the file
 * has loaded (asynchronous, like fetch()).
 */
export function loadGunModel(fit: GunFit): THREE.Group {
  const root = new THREE.Group();
  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/${fit.file}`, (gltf) => {
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      // metalness 0: a "metallic" material only shows color through
      // reflections, and the viewmodel scene has nothing to reflect (no
      // environment map): with the file's 0.4 the gun would look almost black.
      m.metalness = 0;
      if (m.map) {
        // Crisp pixels at any distance: no blurring, no mipmaps. (These
        // models use a "palette" texture: every face samples a flat color
        // square, so nearest filtering keeps colors from bleeding together.)
        m.map.magFilter = THREE.NearestFilter;
        m.map.minFilter = THREE.NearestFilter;
        m.map.generateMipmaps = false;
        m.map.needsUpdate = true;
      }
    });
    const model = gltf.scene;
    model.rotation.set(...fit.rotation);
    model.scale.setScalar(fit.scale);
    model.position.set(...fit.position);
    root.add(model);
  });
  return root;
}
