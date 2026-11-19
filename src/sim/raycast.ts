// Ray casting: "if I shoot a straight line from here in this direction,
// what's the first box it hits, and where?"
import type { Box } from './world';

export interface RayHit {
  /** Distance from the origin to the hit point, meters. */
  distance: number;
  /** Hit point. */
  x: number;
  y: number;
  z: number;
  /** Normal of the face that was hit (points out of the box). */
  nx: number;
  ny: number;
  nz: number;
  /** Index of the box that was hit, in the array passed in. */
  index: number;
}

/**
 * Casts a ray from (ox, oy, oz) along the unit direction (dx, dy, dz) and
 * returns the nearest hit within maxDistance, or null.
 */
export function raycastBoxes(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  boxes: Box[],
): RayHit | null {
  let best: RayHit | null = null;
  boxes.forEach((b, index) => {
    const hit = rayBox(ox, oy, oz, dx, dy, dz, b);
    if (hit && hit.distance <= maxDistance && (!best || hit.distance < best.distance)) {
      best = { ...hit, index };
    }
  });
  return best;
}

/**
 * Ray vs AABB with the "slab method". A box is the intersection of 3 slabs
 * (the space between two parallel planes) — one per axis. For each axis we
 * compute WHEN (at which distance t along the ray) the ray enters and exits
 * that slab. The ray is inside the box when it's inside all 3 slabs at once:
 * from the LATEST entry to the EARLIEST exit. If the latest entry comes after
 * the earliest exit, the ray misses.
 */
function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  b: Box,
): Omit<RayHit, 'index'> | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  let normalAxis = -1; // which axis the latest entry happened on (0 = x, 1 = y, 2 = z)
  let normalSign = 0;

  const origin = [ox, oy, oz];
  const dir = [dx, dy, dz];
  const min = [b.minX, b.minY, b.minZ];
  const max = [b.maxX, b.maxY, b.maxZ];

  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(dir[axis]) < 1e-9) {
      // Parallel to this slab: either always inside it, or never.
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      continue;
    }
    // Distances at which the ray crosses the two planes of this slab.
    let t1 = (min[axis] - origin[axis]) / dir[axis];
    let t2 = (max[axis] - origin[axis]) / dir[axis];
    let sign = -1; // entering through the "min" face → normal points to -axis
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sign = 1;
    }
    if (t1 > tEnter) {
      tEnter = t1;
      normalAxis = axis;
      normalSign = sign;
    }
    tExit = Math.min(tExit, t2);
    if (tEnter > tExit) return null;
  }
  if (tEnter < 0 || normalAxis === -1) return null; // box is behind us (or we're inside it)

  return {
    distance: tEnter,
    x: ox + dx * tEnter,
    y: oy + dy * tEnter,
    z: oz + dz * tEnter,
    nx: normalAxis === 0 ? normalSign : 0,
    ny: normalAxis === 1 ? normalSign : 0,
    nz: normalAxis === 2 ? normalSign : 0,
  };
}
