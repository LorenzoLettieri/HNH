// Textures and materials for the level. The level data only says *what* a
// box is made of (its `look`); this file decides how each look is drawn,
// and turns the hundreds of level boxes into a handful of meshes.
import * as THREE from 'three';
import type { Box } from '../sim/world';
import { addHeightFog } from './heightFog';
import { LEVEL_TEXTURES } from './levelTextures';

/** The material names a visible box can have. */
type Look = NonNullable<Box['look']>;

/**
 * Texel density: how many texture pixels cover one meter of surface.
 * Using the same density for every material keeps all pixels the same
 * size on screen, a big part of a coherent pixel-art look.
 * With 32 px/m, a 64 × 64 texture covers 2 × 2 m.
 */
export const PIXELS_PER_METER = 32;

/**
 * Where `public/` files are served from. Locally it's the site root, on GitHub Pages
 * it's a sub-folder (/HNH/): Vite fills this in from `base` in vite.config.ts.
 */
const BASE = import.meta.env.BASE_URL;

/**
 * How a look is drawn. A texture name is either one painted in code (the names in
 * LEVEL_TEXTURES, src/render/levelTextures.ts) or a file in public/textures/
 * (without `.png`).
 * The 4 sides of a box use `side`; the top and the underside can have their own
 * texture (if missing, they use `side` too): a roof slab with tiles on top and
 * planks underneath, a stone block with paving on top...
 */
interface LookDef {
  side: string;
  top?: string;
  bottom?: string;
  /**
   * How the texture is laid on each face:
   * - false (default): anchored to the WORLD, at the same density everywhere. The
   *   texture runs on seamlessly from one box to the next (a wall built from pieces
   *   around a window looks like one wall), and wall textures start at the ground.
   * - true: FITTED to each face, a whole number of times (at least once). For
   *   textures that are a picture of the whole object, like the side of a crate.
   */
  fit?: boolean;
}

/** Which images each look uses. Change a name here to change a material. */
const LOOKS: Record<Look, LookDef> = {
  dirt: { side: 'floor_ground_dirt' },
  wood: { side: 'timber_square_planks_cross', fit: true },
  stone: { side: 'wall_brick_small_sand', top: 'floor_stone_sand_random' },
  planks: { side: 'floor_wood_planks' },
  // Roof slabs: tiles on top; the edges and the underside (the ceiling, seen from
  // inside a building or under the eaves) are boards.
  roof: { side: 'floor_wood_planks', top: 'shingles' },
  metal: { side: 'iron_plates' },
  rock: { side: 'canyon_rock' },
  brick: { side: 'Brick_1' },
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

/** One material per texture (not per look: two looks using the same image share it). */
const materials = new Map<string, THREE.MeshStandardMaterial>();

/** Paints or downloads (in parallel) all textures and builds the materials. Call once at startup. */
export async function loadMaterials(): Promise<void> {
  const names = new Set<string>();
  for (const look of Object.values(LOOKS)) {
    names.add(look.side);
    if (look.top) names.add(look.top);
    if (look.bottom) names.add(look.bottom);
  }
  await Promise.all(
    [...names].map(async (name) => {
      const paint = LEVEL_TEXTURES[name];
      const map = paint ? paint() : await loadPixelTexture(`${BASE}textures/${name}.png`);
      const material = new THREE.MeshStandardMaterial({ map, roughness: 1 });
      addHeightFog(material);
      materials.set(name, material);
    }),
  );
}

// --- From boxes to meshes ---------------------------------------------------------

type Vec3 = [number, number, number];

/**
 * The 6 faces of a box. For each: where it faces (`normal`) and its own "right" (`u`)
 * and "up" (`v`) directions, as seen from outside. On the sides "up" is always +Y,
 * so wall textures stand upright. u × v = normal: that also makes each face's
 * triangles counter-clockwise seen from outside, which is how the GPU tells the
 * front of a triangle from its back.
 */
const FACES: { normal: Vec3; u: Vec3; v: Vec3; part: 'side' | 'top' | 'bottom' }[] = [
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], part: 'side' }, // east
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], part: 'side' }, // west
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], part: 'side' }, // south
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], part: 'side' }, // north
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], part: 'top' },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], part: 'bottom' },
];

/** A face's 4 corners, as steps along its (u, v) directions: counter-clockwise. */
const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The faces of every box that uses the same texture, merged into one geometry. */
interface Batch {
  positions: number[];
  normals: number[];
  uvs: number[];
  /** Triangles: 3 indices into the vertices each (two per face). */
  indices: number[];
}

/**
 * Builds the level's meshes: ONE mesh per texture, holding the faces of every box
 * that uses it ("static batching").
 *
 * Why: every mesh costs a "draw call", a request from the CPU to the GPU (bind
 * this material, this geometry, draw). One mesh per box meant hundreds of them
 * (twice, with the shadow map), and the CPU side of each call costs much more
 * than drawing a few triangles. The level never moves, so we can merge it once
 * at load time: the GPU draws the same triangles, with a few calls instead.
 * The price: a merged mesh can't be culled piece by piece (it's always drawn whole).
 * Requires loadMaterials() to have finished. Boxes without a look are invisible
 * colliders: skipped.
 */
export function createLevelMeshes(boxes: readonly Box[]): THREE.Mesh[] {
  const batches = new Map<string, Batch>();

  for (const b of boxes) {
    if (!b.look) continue;
    const look = LOOKS[b.look];
    const center: Vec3 = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
    const half: Vec3 = [(b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2, (b.maxZ - b.minZ) / 2];

    for (const face of FACES) {
      // A box resting on the ground (or sunk into it) never shows its underside.
      if (face.part === 'bottom' && b.minY <= 0) continue;

      const name = look[face.part] ?? look.side;
      let batch = batches.get(name);
      if (!batch) {
        batch = { positions: [], normals: [], uvs: [], indices: [] };
        batches.set(name, batch);
      }
      const { width, height } = materials.get(name)!.map!.image as HTMLImageElement;

      // Half the face's size along its u and v, and how far it is from the center.
      const halfU = Math.abs(dot(face.u, half));
      const halfV = Math.abs(dot(face.v, half));
      const halfN = Math.abs(dot(face.normal, half));
      // Fitted textures: how many whole copies fit on the face (at least one).
      const copiesU = Math.max(1, Math.round((2 * halfU * PIXELS_PER_METER) / width));
      const copiesV = Math.max(1, Math.round((2 * halfV * PIXELS_PER_METER) / height));

      const first = batch.positions.length / 3; // index of this face's first vertex
      for (const [su, sv] of CORNERS) {
        const p: Vec3 = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
          p[i] = center[i] + face.normal[i] * halfN + face.u[i] * su * halfU + face.v[i] * sv * halfV;
        }
        batch.positions.push(...p);
        batch.normals.push(...face.normal);
        if (look.fit) {
          // From 0 to `copies` across the face: the image starts at the face's corner.
          batch.uvs.push(((su + 1) / 2) * copiesU, ((sv + 1) / 2) * copiesV);
        } else {
          // World-anchored: the UV is the corner's position measured along the face's
          // own right/up directions (a dot product = projection), in meters, then
          // converted to "texture copies". Two neighboring faces on the same plane
          // compute the same UV at the same point, so the texture has no seams.
          batch.uvs.push((dot(p, face.u) * PIXELS_PER_METER) / width, (dot(p, face.v) * PIXELS_PER_METER) / height);
        }
      }
      batch.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }

  return [...batches].map(([name, batch]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
    geometry.setIndex(batch.indices); // Three.js picks 16- or 32-bit indices by itself
    const mesh = new THREE.Mesh(geometry, materials.get(name)!);
    mesh.castShadow = true; // blocks sunlight
    mesh.receiveShadow = true; // shows shadows cast by others
    return mesh;
  });
}

/**
 * Box geometry for the props: the texture tiled at a constant density on each
 * face, starting from the face's corner.
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
