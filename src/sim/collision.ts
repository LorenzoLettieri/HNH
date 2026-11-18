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
 */
export function moveAndCollide(
  b: Body,
  radius: number,
  height: number,
  boxes: Box[],
  dt: number,
): MoveResult {
  // --- X ---
  b.x += b.vx * dt;
  for (const w of boxes) {
    if (!overlaps(b, radius, height, w)) continue;
    // Moving right → we entered the box from its left face: stop just before it.
    if (b.vx > 0) b.x = w.minX - radius;
    else if (b.vx < 0) b.x = w.maxX + radius;
    b.vx = 0;
  }

  // --- Z ---
  b.z += b.vz * dt;
  for (const w of boxes) {
    if (!overlaps(b, radius, height, w)) continue;
    if (b.vz > 0) b.z = w.minZ - radius;
    else if (b.vz < 0) b.z = w.maxZ + radius;
    b.vz = 0;
  }

  // --- Y ---
  let landed = false;
  b.y += b.vy * dt;
  for (const w of boxes) {
    if (!overlaps(b, radius, height, w)) continue;
    if (b.vy < 0) {
      b.y = w.maxY; // falling → feet on top of the box
      landed = true;
    } else if (b.vy > 0) {
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
