// Dry grass tufts, swaying in the wind.
//
// There can be hundreds of tufts: drawing each one as its own mesh would mean
// hundreds of "draw calls" (one request to the GPU each), which is slow.
// An InstancedMesh draws MANY copies of the same geometry in ONE draw call;
// each copy ("instance") only has its own transform matrix and color.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Box, Prop } from '../../sim/world';
import { patchHeightFog } from '../heightFog';
import { seededRandom } from './pixelCanvas';
import { grassTexture } from './textures';

type GrassPatch = Extract<Prop, { type: 'grass' }>;

/** Size of a tuft, meters (16 px texture at 32 px/m = 0.5 m). */
const TUFT_SIZE = 0.5;
/** Wind sway: how far the tips move, meters. */
const SWAY = 0.08;

/** Shared time uniform: updated once per frame, read by the grass shader. */
const windTime = { value: 0 };

/**
 * One tuft = 3 vertical quads crossed like an asterisk (seen from above: *).
 * From any angle at least one quad faces you, so it reads as a 3D bush.
 */
function tuftGeometry(): THREE.BufferGeometry {
  const quads = [0, 1, 2].map((i) => {
    const quad = new THREE.PlaneGeometry(TUFT_SIZE, TUFT_SIZE);
    quad.translate(0, TUFT_SIZE / 2, 0); // bottom edge on the ground
    quad.rotateY((i / 3) * Math.PI);
    return quad;
  });
  return mergeGeometries(quads); // 3 quads → 1 geometry
}

function grassMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: grassTexture(),
    alphaTest: 0.5, // cut out the transparent pixels: crisp blades, no sorting issues
    side: THREE.DoubleSide, // quads are seen from both sides
    roughness: 1,
  });
  material.onBeforeCompile = (shader) => {
    patchHeightFog(shader);
    shader.uniforms.windTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        // Wind: bend the tuft more the higher the vertex (roots stay put).
        // Each tuft uses its own position (from the instance matrix) as a
        // phase, so a wave of wind travels across the field.
        vec3 tuftPos = instanceMatrix[3].xyz;
        float bend = transformed.y / ${TUFT_SIZE.toFixed(2)};
        float wave = sin(windTime * 2.2 + tuftPos.x * 0.6 + tuftPos.z * 0.4);
        transformed.x += wave * ${SWAY.toFixed(3)} * bend;
        transformed.z += cos(windTime * 1.7 + tuftPos.x * 0.3) * ${(SWAY * 0.5).toFixed(3)} * bend;`,
      );
  };
  return material;
}

/** Is the point (x, z) on top of some solid box (not on the open floor)? */
function blocked(x: number, z: number, boxes: Box[]): boolean {
  return boxes.some(
    (b) =>
      b.maxY > 0.05 &&
      b.minY < 0.05 &&
      x > b.minX - 0.2 &&
      x < b.maxX + 0.2 &&
      z > b.minZ - 0.2 &&
      z < b.maxZ + 0.2,
  );
}

export function createGrass(
  patches: GrassPatch[],
  boxes: Box[],
): { object: THREE.Object3D; update: (t: number) => void } {
  const total = patches.reduce((sum, p) => sum + p.count, 0);
  const mesh = new THREE.InstancedMesh(tuftGeometry(), grassMaterial(), total);
  mesh.receiveShadow = true;

  const rand = seededRandom(42);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  let n = 0;

  for (const patch of patches) {
    for (let i = 0; i < patch.count; i++) {
      // Random point in the circle. sqrt() spreads points evenly over the
      // area; without it they'd crowd toward the center.
      const r = Math.sqrt(rand()) * patch.radius;
      const a = rand() * Math.PI * 2;
      const x = patch.x + Math.cos(a) * r;
      const z = patch.z + Math.sin(a) * r;
      if (blocked(x, z, boxes)) continue;

      const s = 0.6 + rand() * 0.8;
      position.set(x, 0, z);
      rotation.setFromAxisAngle(up, rand() * Math.PI * 2);
      scale.set(s, s * (0.8 + rand() * 0.5), s);
      mesh.setMatrixAt(n, matrix.compose(position, rotation, scale));
      // Per-tuft tint: from green-olive to burnt straw.
      mesh.setColorAt(
        n,
        color.setHSL(0.1 + rand() * 0.06, 0.35 + rand() * 0.2, 0.55 + rand() * 0.25),
      );
      n++;
    }
  }
  mesh.count = n; // only draw the tufts we actually placed

  return {
    object: mesh,
    update(time) {
      windTime.value = time;
    },
  };
}
