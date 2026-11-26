// Textures and materials for the level. The level data only says *what* a
// box is made of (its `look`); this file decides how each look is drawn,
// and turns the hundreds of level boxes into a handful of meshes (quadBatch.ts).
import * as THREE from 'three';
import type { Box, GroundPatch } from '../sim/world';
import { addHeightFog } from './heightFog';
import { LEVEL_TEXTURES } from './levelTextures';
import { BOTTOM, type FaceAxes, QuadBatch, SIDES, TOP, type Vec3, dot } from './quadBatch';

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
  // Ground patches (World.ground).
  road: { side: 'road' },
  paving: { side: 'floor_stone_sand_random' },
  railway: { side: 'railway', fit: true }, // fitted: the rails always fall in the same place

  // Walls. The top of a building is hidden under its roof slab, but small things
  // (a stagecoach, a wagon) show it: wooden walls get planks on top.
  clapboard: { side: 'clapboard_bone', top: 'floor_wood_planks' },
  clapboardRed: { side: 'clapboard_oxblood', top: 'floor_wood_planks' },
  clapboardOchre: { side: 'clapboard_ochre', top: 'floor_wood_planks' },
  // Vertical boards with a horizontal board at the bottom and near the top: anchored
  // to the world, a 4 m wall gets them at its foot and under its roof.
  boards: { side: 'wall_wood_trimsheet', top: 'floor_wood_planks' },
  adobe: { side: 'adobe' },
  stone: { side: 'wall_stone', top: 'floor_stone' },
  brick: { side: 'Brick_1' },
  tin: { side: 'tin' },

  // Wood.
  planks: { side: 'floor_wood_planks' },
  timber: { side: 'timber' },
  crate: { side: 'timber_square_planks_cross', fit: true },

  // Roof slabs: the roofing on top; the edges and the underside (the ceiling, seen
  // from inside a building or under the eaves) are boards.
  roof: { side: 'floor_wood_planks', top: 'shingles' },
  tinRoof: { side: 'floor_wood_planks', top: 'tin' },
  tiles: { side: 'floor_wood_planks', top: 'roof_clay_red_center' },

  metal: { side: 'iron_plates' },
  rock: { side: 'canyon_rock' },
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

/** Big faces are cut into tiles of at most this many meters (see QuadBatch.addTiled). */
const MAX_TILE = 8;

/** The 6 faces of a box, and which texture of the look each one uses. */
const FACES: (FaceAxes & { part: 'side' | 'top' | 'bottom' })[] = [
  { ...SIDES.east, part: 'side' },
  { ...SIDES.west, part: 'side' },
  { ...SIDES.south, part: 'side' },
  { ...SIDES.north, part: 'side' },
  { ...TOP, part: 'top' },
  { ...BOTTOM, part: 'bottom' },
];

/**
 * The texture coordinates of a face 2·halfU × 2·halfV that uses texture `name`,
 * fitted to the face or anchored to the world (see LookDef.fit).
 */
function faceUV(
  name: string,
  fit: boolean | undefined,
  face: FaceAxes,
  halfU: number,
  halfV: number,
): (su: number, sv: number, p: Vec3) => [number, number] {
  const { width, height } = materials.get(name)!.map!.image as HTMLImageElement;
  // Fitted textures: how many whole copies fit on the face (at least one).
  const copiesU = Math.max(1, Math.round((2 * halfU * PIXELS_PER_METER) / width));
  const copiesV = Math.max(1, Math.round((2 * halfV * PIXELS_PER_METER) / height));
  return (su, sv, p) =>
    fit
      ? // From 0 to `copies` across the face: the image starts at the face's corner.
        [((su + 1) / 2) * copiesU, ((sv + 1) / 2) * copiesV]
      : // World-anchored: the UV is the corner's position measured along the face's
        // own right/up directions (a dot product = projection), in meters, then
        // converted to "texture copies". Two neighboring faces on the same plane
        // compute the same UV at the same point, so the texture has no seams.
        [(dot(p, face.u) * PIXELS_PER_METER) / width, (dot(p, face.v) * PIXELS_PER_METER) / height];
}

/**
 * Builds the level's meshes: ONE mesh per texture, holding the faces of every box
 * that uses it ("static batching", see quadBatch.ts).
 * Requires loadMaterials() to have finished. Boxes without a look are invisible
 * colliders: skipped.
 */
export function createLevelMeshes(boxes: readonly Box[]): THREE.Mesh[] {
  const batches = new Map<string, QuadBatch>();

  const batchFor = (name: string) => {
    let batch = batches.get(name);
    if (!batch) {
      batch = new QuadBatch();
      batches.set(name, batch);
    }
    return batch;
  };

  for (const b of boxes) {
    if (!b.look) continue;
    if (b.rise) {
      addWedge(b, batchFor);
      continue;
    }
    const look = LOOKS[b.look];
    const center: Vec3 = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
    const half: Vec3 = [(b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2, (b.maxZ - b.minZ) / 2];

    for (const face of FACES) {
      // A box resting on the ground (or sunk into it) never shows its underside.
      if (face.part === 'bottom' && b.minY <= 0) continue;

      const name = look[face.part] ?? look.side;
      let batch = batches.get(name);
      if (!batch) {
        batch = new QuadBatch();
        batches.set(name, batch);
      }
      // Half the face's size along its u and v, and how far it is from the center.
      const halfU = Math.abs(dot(face.u, half));
      const halfV = Math.abs(dot(face.v, half));
      const halfN = Math.abs(dot(face.normal, half));
      const faceCenter: Vec3 = [0, 1, 2].map((i) => center[i] + face.normal[i] * halfN) as Vec3;
      const uv = faceUV(name, look.fit, face, halfU, halfV);
      // A fitted texture spans the whole face: one quad. The others: tiles (see addTiled).
      if (look.fit) batch.add(faceCenter, face, halfU, halfV, uv);
      else batch.addTiled(faceCenter, face, halfU, halfV, MAX_TILE, uv);
    }
  }

  return [...batches].map(([name, batch]) => {
    const mesh = new THREE.Mesh(batch.toGeometry(), materials.get(name)!);
    mesh.castShadow = true; // blocks sunlight
    mesh.receiveShadow = true; // shows shadows cast by others
    return mesh;
  });
}

/**
 * A wedge (Box.rise, half a pitched roof) as faces: the SLOPE (a rectangle tilted
 * up toward `rise`, with the look's top texture: shingles, tin, tiles), the two
 * TRIANGLES at its ends and the tall rectangle on the high side (the wall's
 * look, `sideLook`, if it has one), and the underside. The low side has no
 * height: no face.
 */
function addWedge(b: Box, batchFor: (name: string) => QuadBatch): void {
  const look = LOOKS[b.look!];
  const wall = LOOKS[b.sideLook ?? b.look!];
  const alongX = b.rise === 'east' || b.rise === 'west';
  // Up the slope, horizontally: (sx, sz). The low and high edges' coordinate along it.
  const sx = b.rise === 'east' ? 1 : b.rise === 'west' ? -1 : 0;
  const sz = b.rise === 'south' ? 1 : b.rise === 'north' ? -1 : 0;
  const run = alongX ? b.maxX - b.minX : b.maxZ - b.minZ;
  const rise = b.maxY - b.minY;
  const slopeLen = Math.hypot(run, rise);

  // --- The slope: v = up the slope (unit), normal = out of it, u = v × normal
  //     (so that u × v = normal, like every face: see FaceAxes). ---
  const v: Vec3 = [(sx * run) / slopeLen, rise / slopeLen, (sz * run) / slopeLen];
  const n: Vec3 = [(-sx * rise) / slopeLen, run / slopeLen, (-sz * rise) / slopeLen];
  const u: Vec3 = [v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0]];
  const slope: FaceAxes = { normal: n, u, v };
  const center: Vec3 = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
  const halfAcross = alongX ? (b.maxZ - b.minZ) / 2 : (b.maxX - b.minX) / 2; // along u
  const top = look.top ?? look.side;
  batchFor(top).addTiled(center, slope, halfAcross, slopeLen / 2, MAX_TILE, faceUV(top, false, slope, halfAcross, slopeLen / 2));

  // --- The tall side: a rectangle on the high edge, facing `rise`. ---
  const tall = SIDES[b.rise!];
  const tallCenter: Vec3 = [
    sx > 0 ? b.maxX : sx < 0 ? b.minX : center[0],
    center[1],
    sz > 0 ? b.maxZ : sz < 0 ? b.minZ : center[2],
  ];
  batchFor(wall.side).addTiled(tallCenter, tall, halfAcross, rise / 2, MAX_TILE, faceUV(wall.side, false, tall, halfAcross, rise / 2));

  // --- The two triangles, at the ends across the slope. Corners: low edge
  //     (bottom), high edge (bottom), high edge (top). ---
  const lowX = sx > 0 ? b.minX : b.maxX;
  const highX = sx > 0 ? b.maxX : b.minX;
  const lowZ = sz > 0 ? b.minZ : b.maxZ;
  const highZ = sz > 0 ? b.maxZ : b.minZ;
  const ends: { facing: 'east' | 'west' | 'south' | 'north'; at: number }[] = alongX
    ? [{ facing: 'north', at: b.minZ }, { facing: 'south', at: b.maxZ }]
    : [{ facing: 'west', at: b.minX }, { facing: 'east', at: b.maxX }];
  for (const end of ends) {
    const face = SIDES[end.facing];
    const p0: Vec3 = alongX ? [lowX, b.minY, end.at] : [end.at, b.minY, lowZ];
    const p1: Vec3 = alongX ? [highX, b.minY, end.at] : [end.at, b.minY, highZ];
    const p2: Vec3 = alongX ? [highX, b.maxY, end.at] : [end.at, b.maxY, highZ];
    // Counter-clockwise seen from outside: check with the normal, flip if not.
    const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const cross: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const uv = faceUV(wall.side, false, face, 1, 1);
    if (dot(cross, face.normal) > 0) batchFor(wall.side).addTriangle(p0, p1, p2, face.normal, uv);
    else batchFor(wall.side).addTriangle(p0, p2, p1, face.normal, uv);
  }

  // --- The underside (hidden on a roof slab, seen under a ramp in the air). ---
  if (b.minY > 0) {
    const under = look.bottom ?? look.side;
    const halfX = (b.maxX - b.minX) / 2;
    const halfZ = (b.maxZ - b.minZ) / 2;
    batchFor(under).addTiled([center[0], b.minY, center[2]], BOTTOM, halfX, halfZ, MAX_TILE, faceUV(under, false, BOTTOM, halfX, halfZ));
  }
}

/**
 * How high the ground patches float above the ground: 1 cm. Two surfaces on the
 * SAME plane are never safe: each triangle computes its depth with its own small
 * rounding errors (the GPU snaps the corners to a sub-pixel grid), and seen at a
 * grazing angle, at our low resolution where one pixel covers a lot of ground,
 * those errors are bigger than the difference between the two: pixel by pixel,
 * sometimes one wins, sometimes the other ("z-fighting": the floors flickered
 * when turning the view). polygonOffset fixes it only by nudging the patch toward
 * the camera in proportion to the slope, and at grazing angles that nudge became
 * tens of centimeters: the road covered the vents' grates (2 cm up). A real gap of
 * 1 cm is invisible, yet bigger than the errors at any distance in this town.
 * What lies on the floor must be above it: vents (2 cm), the light pools of the
 * pickups (2 cm), bullet holes (2 cm, impacts.ts).
 */
const GROUND_LIFT = 0.01;

/**
 * The ground patches (World.ground: streets, squares, boardwalks, rails): one flat
 * face each, GROUND_LIFT above the ground, merged per texture like the boxes.
 */
export function createGroundMeshes(patches: readonly GroundPatch[]): THREE.Mesh[] {
  const batches = new Map<string, QuadBatch>();
  for (const g of patches) {
    const look = LOOKS[g.look];
    const name = look.top ?? look.side;
    let batch = batches.get(name);
    if (!batch) {
      batch = new QuadBatch();
      batches.set(name, batch);
    }
    const halfU = (g.maxX - g.minX) / 2; // TOP's u runs along X...
    const halfV = (g.maxZ - g.minZ) / 2; // ...and its v along Z
    const center: Vec3 = [(g.minX + g.maxX) / 2, GROUND_LIFT, (g.minZ + g.maxZ) / 2];
    const uv = faceUV(name, look.fit, TOP, halfU, halfV);
    if (look.fit) batch.add(center, TOP, halfU, halfV, uv);
    else batch.addTiled(center, TOP, halfU, halfV, MAX_TILE, uv);
  }
  return [...batches].map(([name, batch]) => {
    const mesh = new THREE.Mesh(batch.toGeometry(), materials.get(name)!);
    mesh.receiveShadow = true; // flat on the ground: it receives shadows, it doesn't cast them
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
