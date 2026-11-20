// Loads a gun model (.glb) for the viewmodel.
//
// Our gun models are already in the viewmodel's conventions: barrel along
// -Z, up = +Y, meters, origin = where the right hand holds the grip. (The
// downloaded originals weren't: we turned, scaled and moved them in Blender,
// once; the originals are in assets-src/.) Moving parts are separate objects
// with their origin on their pivot: `onLoad` receives the model to find them
// by name.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Returns a group right away; the model is added inside it when the file
 * has loaded (asynchronous, like fetch()).
 */
export function loadGunModel(file: string, onLoad?: (model: THREE.Object3D) => void): THREE.Group {
  const root = new THREE.Group();
  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/${file}`, (gltf) => {
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      // metalness 0: a "metallic" material only shows color through
      // reflections, and the viewmodel scene has nothing to reflect (no
      // environment map): with the files' 0.4 the gun would look almost black.
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
    root.add(gltf.scene);
    onLoad?.(gltf.scene);
  });
  return root;
}
