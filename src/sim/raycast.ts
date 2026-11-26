// Ray casting: "if I shoot a straight line from here in this direction,
// what's the first box it hits, and where?"
import { gradientOf, type Box } from './world';

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
  if (normalAxis === -1) return null;
  let nx = normalAxis === 0 ? normalSign : 0;
  let ny = normalAxis === 1 ? normalSign : 0;
  let nz = normalAxis === 2 ? normalSign : 0;

  // A wedge (Box.rise) is the box cut by its slanted plane: one more "slab",
  // a half-space this time (everything under the plane). The plane as
  // n·p = c, with n pointing up and out of the slope. Where the ray crosses
  // it: t = (c − n·o) / (n·d). Going against n (n·d < 0) it ENTERS the
  // solid there, going along n it LEAVES it: the same "latest entry,
  // earliest exit" as the other slabs.
  if (b.rise) {
    const g = gradientOf(b);
    // Up the slope = the rise direction (sx, sz); the plane is y = minY + g·(distance from the low edge).
    const sx = b.rise === 'east' ? 1 : b.rise === 'west' ? -1 : 0;
    const sz = b.rise === 'south' ? 1 : b.rise === 'north' ? -1 : 0;
    const lowX = sx > 0 ? b.minX : b.maxX;
    const lowZ = sz > 0 ? b.minZ : b.maxZ;
    // y − g·(sx·(x − lowX) + sz·(z − lowZ)) = minY  →  n = (−g·sx, 1, −g·sz)
    const pnx = -g * sx;
    const pnz = -g * sz;
    const c = b.minY - g * (sx * lowX + sz * lowZ);
    const along = pnx * dx + dy + pnz * dz;
    const from = pnx * ox + oy + pnz * oz - c; // > 0 = the origin is above the plane
    if (Math.abs(along) < 1e-9) {
      if (from > 0) return null; // parallel to the plane, above it: never inside
    } else {
      const t = -from / along;
      if (along < 0) {
        if (t > tEnter) {
          tEnter = t;
          const len = Math.hypot(pnx, 1, pnz);
          nx = pnx / len;
          ny = 1 / len;
          nz = pnz / len;
        }
      } else {
        tExit = Math.min(tExit, t);
      }
      if (tEnter > tExit) return null;
    }
  }
  if (tEnter < 0) return null; // box is behind us (or we're inside it)

  return {
    distance: tEnter,
    x: ox + dx * tEnter,
    y: oy + dy * tEnter,
    z: oz + dz * tEnter,
    nx,
    ny,
    nz,
  };
}
