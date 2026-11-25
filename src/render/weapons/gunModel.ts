// Loads a gun model (.glb) for the viewmodel.
//
// Our gun models are already in the viewmodel's conventions: barrel along
// -Z, up = +Y, meters, origin = where the right hand holds the grip. (The
// downloaded originals weren't: we turned, scaled and moved them in Blender,
// once; the originals are in assets-src/.) Moving parts are separate objects
// with their origin on their pivot: `onLoad` receives the model to find them
// by name.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

// --- Every .glb goes through loadGltf: so the loading screen can wait for them ---
let pending = 0;
let waiting: (() => void)[] = [];

/**
 * Loads a .glb file of public/models/ (GLTFLoader, asynchronous like fetch())
 * and calls `onLoad` with it. It also counts the files still on their way,
 * for modelsLoaded(). A file that fails is counted as done (with a warning):
 * the game goes on without that model rather than waiting forever.
 */
export function loadGltf(file: string, onLoad: (gltf: GLTF) => void): void {
  pending++;
  const done = (): void => {
    pending--;
    if (pending === 0) {
      for (const resolve of waiting) resolve();
      waiting = [];
    }
  };
  new GLTFLoader().load(
    `${import.meta.env.BASE_URL}models/${file}`,
    (gltf) => {
      onLoad(gltf);
      done();
    },
    undefined,
    (err) => {
      console.warn(`Model ${file} not loaded:`, err);
      done();
    },
  );
}

/** Resolves when every model asked for so far has arrived (like Promise.all over the loads). */
export function modelsLoaded(): Promise<void> {
  if (pending === 0) return Promise.resolve();
  return new Promise((resolve) => waiting.push(resolve));
}

/**
 * Returns a group right away; the model is added inside it when the file
 * has loaded (asynchronous, like fetch()).
 */
export function loadGunModel(file: string, onLoad?: (model: THREE.Object3D) => void): THREE.Group {
  const root = new THREE.Group();
  loadGltf(file, (gltf) => {
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
