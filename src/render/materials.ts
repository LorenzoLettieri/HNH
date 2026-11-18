// Textures and materials for the level. The level data only says *what* a
// box is made of (its `look`); this file decides how each look is drawn.
import * as THREE from 'three';
import type { Box } from '../sim/world';

/** The material names a visible box can have. */
type Look = NonNullable<Box['look']>;
import { addHeightFog } from './heightFog';

/**
 * Texel density: how many texture pixels cover one meter of surface.
 * Using the same density for every material keeps all pixels the same
 * size on screen, a big part of a coherent pixel-art look.
 * With 32 px/m, a 64 × 64 texture covers 2 × 2 m.
 */
export const PIXELS_PER_METER = 32;

/** Which image each look uses. Swap a file name here to change a material. */
const LOOKS: Record<Look, string> = {
  dirt: '/textures/floor_ground_dirt.png',
  wood: '/textures/timber_square_planks_cross.png',
  stone: '/textures/wall_brick_small_sand.png',
};

const loader = new THREE.TextureLoader();

async function loadPixelTexture(url: string): Promise<THREE.Texture> {
  // Wait for the download: we need the image's size to tile it correctly.
  const tex = await loader.loadAsync(url);
  // Up close: show the texture's pixels as sharp squares instead of blurring them.
  tex.magFilter = THREE.NearestFilter;
  // Far away: use smaller pre-computed versions (mipmaps) to avoid shimmering,
  // still picking pixels without blending them.
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  // Repeat the image when UVs go past 1, instead of stretching the last pixel.
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // The PNG's colors are in sRGB (like everything on the web): tell Three.js,
  // otherwise lighting math treats them as linear and they look washed out.
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const materials = {} as Record<Look, THREE.MeshStandardMaterial>;

/** Downloads all textures (in parallel) and builds the materials. Call once at startup. */
export async function loadMaterials(): Promise<void> {
  const looks = Object.keys(LOOKS) as Look[];
  const textures = await Promise.all(looks.map((look) => loadPixelTexture(LOOKS[look])));
  looks.forEach((look, i) => {
    materials[look] = new THREE.MeshStandardMaterial({ map: textures[i], roughness: 1 });
    addHeightFog(materials[look]);
  });
}

/** Builds the mesh for one level box, with the texture tiled at a constant density.
 * Requires loadMaterials() to have finished. */
export function createBoxMesh(b: Box): THREE.Mesh {
  const sizeX = b.maxX - b.minX;
  const sizeY = b.maxY - b.minY;
  const sizeZ = b.maxZ - b.minZ;
  const material = materials[b.look!];
  const { width, height } = material.map!.image as HTMLImageElement;
  const geometry = texturedBoxGeometry(sizeX, sizeY, sizeZ, width, height);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; // blocks sunlight
  mesh.receiveShadow = true; // shows shadows cast by others
  // BoxGeometry is centered on its origin: place the mesh at the box's center.
  mesh.position.set(b.minX + sizeX / 2, b.minY + sizeY / 2, b.minZ + sizeZ / 2);
  return mesh;
}

/**
 * UVs are the 2D coordinates that say which point of the texture goes on each
 * vertex: (0,0) = bottom-left of the image, (1,1) = top-right.
 * BoxGeometry maps the whole image once on every face, so a 40 m floor would
 * show one giant stretched image. Here we scale each face's UVs by its size
 * in meters, so the texture repeats every (image size / PIXELS_PER_METER) m.
 */
export function texturedBoxGeometry(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  texW: number,
  texH: number,
): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);

  // BoxGeometry has 6 faces × 4 vertices, in this face order: +X, -X, +Y, -Y, +Z, -Z.
  // For each face: which box dimensions run along the texture's U and V axes.
  const faceSizes: [number, number][] = [
    [sizeZ, sizeY], // +X side: U along Z, V along Y
    [sizeZ, sizeY], // -X side
    [sizeX, sizeZ], // +Y top: U along X, V along Z
    [sizeX, sizeZ], // -Y bottom
    [sizeX, sizeY], // +Z side: U along X, V along Y
    [sizeX, sizeY], // -Z side
  ];

  const uv = geometry.attributes.uv;
  for (let face = 0; face < 6; face++) {
    const [sizeU, sizeV] = faceSizes[face];
    const repeatU = (sizeU * PIXELS_PER_METER) / texW;
    const repeatV = (sizeV * PIXELS_PER_METER) / texH;
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * repeatU, uv.getY(i) * repeatV);
    }
  }
  return geometry;
}
