// Building blocks shared by all prop models.
import * as THREE from 'three';
import { addHeightFog } from '../heightFog';
import { PIXELS_PER_METER, texturedBoxGeometry } from '../materials';
import { flameSheet } from './textures';

/** What every prop builder returns. */
export interface PropModel {
  object: THREE.Object3D;
  /** Flames in this prop, in the prop's LOCAL coordinates (converted to world later). */
  fires?: LocalFire[];
  /** Called every frame (animations: swinging signs, flame frames, ...). */
  update?: (time: number) => void;
  /** Parts that move (animated by update): kept out of the static batching (batch.ts). */
  moving?: THREE.Object3D[];
}

export interface LocalFire {
  position: THREE.Vector3;
  intensity: number;
  range: number;
  flicker: number;
  haloSize: number;
  emberRate: number;
  glowMaterials?: THREE.MeshStandardMaterial[];
}

/** Material cache: one material per texture, shared by every prop using it. */
const materialCache = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
const doubleSidedCache = new Map<THREE.Texture, THREE.MeshStandardMaterial>();

/**
 * Standard lit material with our ground fog, for solid prop parts.
 * `doubleSide`: also draw the back of faces (for open shapes you can see inside).
 */
export function propMaterial(
  texture: THREE.Texture,
  doubleSide = false,
): THREE.MeshStandardMaterial {
  const cache = doubleSide ? doubleSidedCache : materialCache;
  let m = cache.get(texture);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.95,
      side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });
    addHeightFog(m);
    cache.set(texture, m);
  }
  return m;
}

/** A mesh that casts and receives shadows, like every solid part of a prop. */
export function solid(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A box whose texture repeats at the level's texel density (same pixel size everywhere). */
export function texturedBox(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  texture: THREE.Texture,
): THREE.Mesh {
  const { width, height } = texture.image as HTMLCanvasElement;
  return solid(texturedBoxGeometry(sizeX, sizeY, sizeZ, width, height), propMaterial(texture));
}

/**
 * Scales a geometry's UVs so its texture repeats `u` times around and `v`
 * times along. Changing the geometry instead of texture.repeat lets many
 * meshes share the same texture with different tilings.
 */
export function scaleUV<T extends THREE.BufferGeometry>(geometry: T, u: number, v: number): T {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return geometry;
}

/** How many times a texture of `pixels` px must repeat over `meters` to keep our density. */
export function repeatsFor(meters: number, pixels: number): number {
  return Math.max(1, Math.round((meters * PIXELS_PER_METER) / pixels));
}

/** Flame brightness: above 1 it's "brighter than white" and triggers the bloom. */
const FLAME_BRIGHTNESS = 3;
const FLAME_FPS = 10;

/**
 * An animated flame: a Sprite (always faces the camera, like Doom's fire)
 * showing one frame of the flame sheet at a time.
 * Anchored at its bottom center, so it "grows" up from `position`.
 */
export function createFlame(
  width: number,
  height: number,
): {
  sprite: THREE.Sprite;
  update: (time: number) => void;
} {
  // Each flame gets its own copy of the texture object (sharing the same
  // image) so it can show a different frame than the others.
  const map = flameSheet().clone();
  const frames = Math.round(1 / map.repeat.x);
  const material = new THREE.SpriteMaterial({
    map,
    // alphaTest: pixels more transparent than this are discarded entirely.
    // Hard-edged pixel art, and no transparency sorting problems.
    alphaTest: 0.5,
    color: new THREE.Color(1, 1, 1).multiplyScalar(FLAME_BRIGHTNESS),
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0); // anchor: bottom center
  sprite.scale.set(width, height, 1);
  const phase = Math.random() * 10;
  return {
    sprite,
    update(time) {
      const frame = Math.floor((time + phase) * FLAME_FPS) % frames;
      map.offset.x = frame / frames;
      // A slight breathing of the size makes 4 frames feel like many more.
      sprite.scale.set(width, height * (1 + 0.08 * Math.sin((time + phase) * 13)), 1);
    },
  };
}
