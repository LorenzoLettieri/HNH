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
    this.addRect(center, face, -halfU, halfU, -halfV, halfV, uv);
  }

  /**
   * The same, with the rectangle given by where its edges are along the face's u
   * (u0..u1) and v (v0..v1), measured from `origin`. Two rectangles sharing an edge
   * value compute bit-identical corners there: no hairline cracks between them.
   */
  addRect(
    origin: Vec3,
    face: FaceAxes,
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    uv: (su: number, sv: number, p: Vec3) => [number, number],
  ): void {
    const first = this.positions.length / 3; // index of this quad's first vertex
    for (const [su, sv] of CORNERS) {
      const du = su < 0 ? u0 : u1;
      const dv = sv < 0 ? v0 : v1;
      const p: Vec3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) p[i] = origin[i] + face.u[i] * du + face.v[i] * dv;
      this.positions.push(...p);
      this.normals.push(...face.normal);
      this.uvs.push(...uv(su, sv, p));
    }
    this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  /**
   * Adds a big rectangle cut into tiles of at most `maxTile` m per side. Why: the
   * GPU computes each pixel's depth by interpolating across the triangle, with
   * small rounding errors that grow with the triangle's size. The ground was two
   * triangles 92 m wide: its errors were bigger than the gap to the patches lying
   * on it, and they flickered through each other. Smaller triangles, smaller errors.
   * Only for textures anchored to the world (their UVs don't care about the cuts).
   */
  addTiled(
    center: Vec3,
    face: FaceAxes,
    halfU: number,
    halfV: number,
    maxTile: number,
    uv: (su: number, sv: number, p: Vec3) => [number, number],
  ): void {
    const edges = (half: number) => {
      const n = Math.max(1, Math.ceil((2 * half) / maxTile));
      return Array.from({ length: n + 1 }, (_, i) => -half + (2 * half * i) / n);
    };
    const us = edges(halfU);
    const vs = edges(halfV);
    for (let i = 0; i + 1 < us.length; i++) {
      for (let j = 0; j + 1 < vs.length; j++) this.addRect(center, face, us[i], us[i + 1], vs[j], vs[j + 1], uv);
    }
  }

  /**
   * Adds a triangle (the gable end of a pitched roof). `a, b, c` counter-clockwise
   * seen from outside, so the GPU knows its front; `uv` like the quads' (only the
   * position counts: the textures on triangles are anchored to the world).
   */
  addTriangle(a: Vec3, b: Vec3, c: Vec3, normal: Vec3, uv: (su: number, sv: number, p: Vec3) => [number, number]): void {
    const first = this.positions.length / 3;
    for (const p of [a, b, c]) {
      this.positions.push(...p);
      this.normals.push(...normal);
      this.uvs.push(...uv(0, 0, p));
    }
    this.indices.push(first, first + 1, first + 2);
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
