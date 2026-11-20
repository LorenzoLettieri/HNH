// Static batching: many flat rectangles ("quads") merged into ONE geometry.
//
// Every mesh costs a "draw call", a request from the CPU to the GPU (bind this
// material, this geometry, draw). One mesh per box meant hundreds of them (twice,
// with the shadow map), and the CPU side of each call costs much more than drawing
// a few triangles. The level never moves, so we merge it once at load time: the GPU
// draws the same triangles with a few calls. The price: a merged mesh can't be
// culled piece by piece (it's always drawn whole).
// Used by the level's boxes (materials.ts) and by the doors and windows (decals.ts).
import * as THREE from 'three';
import type { Facing } from '../sim/world';

export type Vec3 = [number, number, number];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * A face's orientation: where it faces (`normal`) and its own "right" (`u`) and
 * "up" (`v`) directions, as seen from outside. On the sides "up" is always +Y, so
 * wall textures stand upright. u × v = normal: that also makes the triangles
 * counter-clockwise seen from outside, which is how the GPU tells the front of a
 * triangle from its back.
 */
export interface FaceAxes {
  normal: Vec3;
  u: Vec3;
  v: Vec3;
}

/** The four vertical sides, by the direction they face. */
export const SIDES: Record<Facing, FaceAxes> = {
  east: { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  west: { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  south: { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  north: { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
};
export const TOP: FaceAxes = { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] };
export const BOTTOM: FaceAxes = { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] };

/** A quad's 4 corners, as steps along its (u, v) directions: counter-clockwise. */
const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** Vertices and triangles of many quads, to become one BufferGeometry. */
export class QuadBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  /** Triangles: 3 indices into the vertices each (two per quad). */
  private readonly indices: number[] = [];

  /**
   * Adds a rectangle centered on `center`, lying along the axes of `face`,
   * 2·halfU wide and 2·halfV tall. `uv` gives each corner's texture coordinates:
   * su, sv = -1 or +1 say which corner, p is where it is in the world.
   */
  add(
    center: Vec3,
    face: FaceAxes,
    halfU: number,
    halfV: number,
    uv: (su: number, sv: number, p: Vec3) => [number, number],
  ): void {
    const first = this.positions.length / 3; // index of this quad's first vertex
    for (const [su, sv] of CORNERS) {
      const p: Vec3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) p[i] = center[i] + face.u[i] * su * halfU + face.v[i] * sv * halfV;
      this.positions.push(...p);
      this.normals.push(...face.normal);
      this.uvs.push(...uv(su, sv, p));
    }
    this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices); // Three.js picks 16- or 32-bit indices by itself
    return geometry;
  }
}
