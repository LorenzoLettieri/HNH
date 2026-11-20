// Moves a box-shaped body through a world of boxes, one axis at a time.
import type { Box } from './world';

/**
 * Tiny tolerance. Boxes that merely touch (or overlap by a rounding error)
 * don't count as colliding, otherwise floating-point noise would make you
 * "collide" with a wall you're just standing next to.
 */
const EPSILON = 1e-6;

/** The moving body: feet position + size. Velocity is changed on impact. */
export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface MoveResult {
  /** We hit something below us while falling: we're standing on it. */
  landed: boolean;
}

/**
 * Moves `b` by its velocity × dt, stopping at walls/floors/ceilings.
 *
 * Axis-by-axis resolution: move along X and fix any overlap, then Z, then Y.
 * Handling one axis at a time makes the "which way do I push back?" question
 * trivial (the opposite of the direction we just moved), and it gives sliding
 * along walls for free: hitting a wall on X zeroes only vx, vz keeps going.
 *
 * The direction of the move is read BEFORE checking the boxes (dirX, dirZ, dirY):
 * the body can overlap several boxes at once, and the first one hit sets the
 * speed to 0. Reading the speed again for the second box, it would say "not
 * moving" and leave us inside it. That happened landing on a roof from high up:
 * at 24 m/s the feet go down 40 cm per tick, more than the roof slab (30 cm), so
 * they ended up inside the building block AND the slab; the block pushed them up
 * to its top (9.0 m), the slab (9.0..9.3) didn't push at all, and the next
 * sideways step found us inside the slab and shoved us out over the edge.
 */
export function moveAndCollide(
  b: Body,
  radius: number,
  height: number,
  boxes: Box[],
  dt: number,
): MoveResult {
  // --- X ---
  const dirX = Math.sign(b.vx);
  b.x += b.vx * dt;
  for (const w of boxes) {
    if (!overlaps(b, radius, height, w)) continue;
    // Moving right → we entered the box from its left face: stop just before it.
    if (dirX > 0) b.x = w.minX - radius;
    else if (dirX < 0) b.x = w.maxX + radius;
    b.vx = 0;
  }

  // --- Z ---
  const dirZ = Math.sign(b.vz);
  b.z += b.vz * dt;
  for (const w of boxes) {
    if (!overlaps(b, radius, height, w)) continue;
    if (dirZ > 0) b.z = w.minZ - radius;
    else if (dirZ < 0) b.z = w.maxZ + radius;
    b.vz = 0;
  }

  // --- Y ---
  let landed = false;
  const dirY = Math.sign(b.vy);
  b.y += b.vy * dt;
  for (const w of boxes) {
    if (!overlaps(b, radius, height, w)) continue;
    if (dirY < 0) {
      b.y = w.maxY; // falling → feet on top of the box
      landed = true;
    } else if (dirY > 0) {
      b.y = w.minY - height; // rising → head against the ceiling
    }
    b.vy = 0;
  }

  return { landed };
}

/** Do the body's box and the world box intersect? (on all three axes at once) */
function overlaps(b: Body, radius: number, height: number, w: Box): boolean {
  return (
    b.x - radius < w.maxX - EPSILON &&
    b.x + radius > w.minX + EPSILON &&
    b.y < w.maxY - EPSILON &&
    b.y + height > w.minY + EPSILON &&
    b.z - radius < w.maxZ - EPSILON &&
    b.z + radius > w.minZ + EPSILON
  );
}

/**
 * Would a body of this size, standing at (x, y, z), overlap any box?
 * Used e.g. to check if there's room to stand up after crouching.
 */
export function overlapsAny(
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  boxes: Box[],
): boolean {
  const probe = { x, y, z, vx: 0, vy: 0, vz: 0 };
  return boxes.some((w) => overlaps(probe, radius, height, w));
}

/**
 * Looks for a wall within `reach` meters of the body's sides (only the 4
 * horizontal directions: our boxes are axis-aligned, so walls face ±X or ±Z).
 * Returns the wall's normal (the direction pointing AWAY from the wall,
 * toward the body), or null if there's none.
 */
export function findWall(
  b: Body,
  radius: number,
  height: number,
  reach: number,
  boxes: Box[],
): { nx: number; nz: number } | null {
  const directions = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
  ];
  for (const { dx, dz } of directions) {
    // Slide a copy of the body `reach` meters that way: if it now overlaps
    // something it didn't before, there's a wall on that side.
    const probe = { ...b, x: b.x + dx * reach, z: b.z + dz * reach };
    // Ignore the bottom 10 cm, so the floor or a tiny step doesn't count as a wall.
    const lifted = { ...probe, y: probe.y + 0.1 };
    if (boxes.some((w) => overlaps(lifted, radius, height - 0.1, w))) {
      return { nx: -dx, nz: -dz };
    }
  }
  return null;
}
