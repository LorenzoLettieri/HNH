// Bullet impacts: a hole left on the surface ("decal") and a flash of light.
// The sparks are in particles.ts.
import * as THREE from 'three';
import { PixelCanvas, seededRandom } from './props/pixelCanvas';
import { addSpecimen } from './warmUp';

/** How many holes stay on the walls; the oldest is reused after that. */
const MAX_DECALS = 64;
/** Size of a hole, meters. */
const DECAL_SIZE = 0.22;

/** A charred bullet hole: black center, dark ring, transparent outside. */
function holeTexture(): THREE.Texture {
  const S = 8;
  const c = new PixelCanvas(S, S);
  const rand = seededRandom(77);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5);
      if (r < 1.3) c.set(x, y, 0x050302);
      else if (r < 2.6 + rand() * 0.8) c.set(x, y, 0x2a1a10, 200);
    }
  }
  return c.toTexture();
}

export interface Impacts {
  add(point: THREE.Vector3, normal: THREE.Vector3): void;
}

export function createImpacts(scene: THREE.Scene): Impacts {
  const material = new THREE.MeshBasicMaterial({
    map: holeTexture(),
    transparent: true,
    depthWrite: false,
    // polygonOffset nudges the decal's depth toward the camera, so it doesn't
    // flicker against the wall it's lying on ("z-fighting").
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
  const geometry = new THREE.PlaneGeometry(DECAL_SIZE, DECAL_SIZE);
  const decals: THREE.Mesh[] = [];
  let next = 0;
  const target = new THREE.Vector3();
  // One hidden at startup, so the warm-up compiles its shaders (render/warmUp.ts).
  addSpecimen(scene, () => scene.add(new THREE.Mesh(geometry, material)));

  return {
    add(point, normal) {
      // Pool: create meshes until MAX_DECALS, then recycle the oldest.
      let decal = decals[next];
      if (!decal) {
        decal = new THREE.Mesh(geometry, material);
        decals.push(decal);
        scene.add(decal);
      }
      next = (next + 1) % MAX_DECALS;

      // Lie flat on the surface: a plane faces +Z, so make it look along the normal.
      // 2 cm out: above the ground patches (1 cm) and the doors and windows (5 mm),
      // which float over their surfaces (GROUND_LIFT in materials.ts, DECAL_LIFT in decals.ts).
      decal.position.copy(point).addScaledVector(normal, 0.02);
      target.copy(decal.position).add(normal);
      decal.lookAt(target);
      decal.rotateZ(Math.random() * Math.PI * 2); // random spin: holes don't all look the same
      decal.scale.setScalar(0.7 + Math.random() * 0.6);
    },
  };
}
