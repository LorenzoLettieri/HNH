// Moves a box-shaped body through a world of boxes, one axis at a time.
// Some boxes are SLOPES (wedges, `Box.rise`): walking into one lifts you onto
// it instead of stopping you, and a body that was standing sticks to it.
import { gradientOf, slopeAt, surfaceAt, type Box } from './world';

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
  /**
   * Was it standing on something at the start of this move? Only bodies that
   * walk have it (the player, the enemies); a walker that was standing sticks
   * to a slope going downhill instead of flying off it (see "Slopes" below).
   * Whoever jumps sets it to false BEFORE moving: the jump isn't glued down.
   */
  onGround?: boolean;
}

export interface MoveResult {
  /** We hit something below us while falling: we're standing on it. */
  landed: boolean;
  /**
   * The slope we're standing on (meters up per meter along X and Z), 0 on
   * flat ground or in the air. The player's slide reads it: downhill it speeds up.
   */
  slopeX: number;
  slopeZ: number;
}

/**
 * Highest step a body is lifted onto without being stopped, on top of what the
 * slope itself asks, meters: a few centimeters of rounding, nothing a ghoul
 * could notice (the stairs are still jumped).
 */
const SLOPE_STEP = 0.06;
/**
 * A walker going UP faster than the slope under it, by more than this (m/s),
 * leaves it: at the top of a ramp, or over a roof's ridge, the speed you had
 * climbing throws you in the air (a ramp jump) instead of gluing you down.
 */
const SLOPE_RELEASE = 0.5;

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
  const startX = b.x;
  const startZ = b.z;
  const vyBefore = b.vy;

  // --- X ---
  const dirX = Math.sign(b.vx);
  b.x += b.vx * dt;
  for (const w of boxes) {
    if (!overlaps(b, radius, height, w)) continue;
    if (w.rise && climb(b, radius, height, w, boxes, Math.hypot(b.x - startX, b.z - startZ))) continue;
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
    if (w.rise && climb(b, radius, height, w, boxes, Math.hypot(b.x - startX, b.z - startZ))) continue;
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
    if (dirY <= 0 && w.rise) {
      b.y = surfaceAt(w, b.x, b.z, radius); // falling onto a slope → feet on the plane
      landed = true;
    } else if (dirY < 0) {
      b.y = w.maxY; // falling → feet on top of the box
      landed = true;
    } else if (dirY > 0) {
      b.y = w.minY - height; // rising → head against the ceiling
    }
    b.vy = 0;
  }

  // --- Slopes: what are we standing on? ---
  const slope = restOnSlope(b, radius, height, boxes, Math.hypot(b.x - startX, b.z - startZ), vyBefore, landed);
  if (slope) landed = true;
  return { landed, slopeX: slope?.gx ?? 0, slopeZ: slope?.gz ?? 0 };
}

/**
 * Moving sideways into a wedge: did we walk UP its slope (then lift the body
 * onto the plane and keep going) or into one of its walls (then the caller
 * stops us, like any box)? It's the slope if the lift is no more than the
 * slope can explain over the distance moved this tick (gradient × distance,
 * plus a few centimeters). Walking into the tall end of a ramp asks for a
 * much bigger lift: that's a wall. And only if the body fits up there (a
 * beam over the roof stops you like a wall).
 */
function climb(b: Body, radius: number, height: number, w: Box, boxes: Box[], moved: number): boolean {
  const top = surfaceAt(w, b.x, b.z, radius);
  if (top - b.y > gradientOf(w) * moved + SLOPE_STEP) return false;
  const y = b.y;
  b.y = top;
  // Headroom: any other box in the way? (Other slopes are fine: the loop lifts us onto them too.)
  if (boxes.some((o) => o !== w && !o.rise && overlaps(b, radius, height, o))) {
    b.y = y;
    return false;
  }
  return true;
}

/**
 * After the move: is the body resting on a slope? Two cases:
 * 1. it touches one already (it landed on it, or `climb` lifted it there);
 * 2. it's a walker that was standing and the slope is just under its feet,
 *    no farther than the slope explains over this tick's move: going DOWNHILL
 *    the plane drops away under you faster than gravity pulls you down
 *    (9 cm per tick running down a roof, against 0.5 cm of fall), so without
 *    this you'd hop down a roof in a string of tiny flights. We put it back
 *    on the plane ("ground snapping").
 *    Not if it's going up faster than the slope (SLOPE_RELEASE): that's a
 *    ramp jump, or a jump (whoever jumps isn't onGround any more).
 * Then the vertical speed becomes the slope's: vy = (vx, vz) · gradient. So
 * running up a ramp you really move UP, and leaving its top you keep flying.
 */
function restOnSlope(
  b: Body,
  radius: number,
  height: number,
  boxes: Box[],
  moved: number,
  vyBefore: number,
  landed: boolean,
): { gx: number; gz: number } | null {
  let best: Box | null = null;
  let bestTop = -Infinity;
  for (const w of boxes) {
    if (!w.rise) continue;
    // Under the footprint?
    if (b.x - radius >= w.maxX || b.x + radius <= w.minX || b.z - radius >= w.maxZ || b.z + radius <= w.minZ) continue;
    const top = surfaceAt(w, b.x, b.z, radius);
    const gap = b.y - top;
    if (gap < -0.001 || top <= bestTop) continue;
    if (gap > 0.001) {
      // Not touching: snap down onto it? Only a walker that was standing.
      if (!b.onGround || gap > gradientOf(w) * moved + SLOPE_STEP) continue;
      const g = slopeAt(w, b.x, b.z, radius);
      if (vyBefore > Math.max(0, b.vx * g.gx + b.vz * g.gz) + SLOPE_RELEASE) continue;
      // Nothing between us and the plane (we'd have landed on it already, but
      // snapping down into a box would put us inside it).
      const y = b.y;
      b.y = top;
      const blocked = boxes.some((o) => !o.rise && overlaps(b, radius, height, o));
      b.y = y;
      if (blocked) continue;
    }
    best = w;
    bestTop = top;
  }
  if (!best) return null;
  // Landed on a flat box this tick, higher than the slope? Then the box holds us.
  if (landed && b.y > bestTop + 0.001) return null;
  b.y = bestTop;
  const g = slopeAt(best, b.x, b.z, radius);
  // Only the walkers take the slope's vertical speed. A thrown stick, a coin,
  // just land on it (their bounce code reads the zeroed vy as "hit the floor").
  b.vy = 'onGround' in b ? b.vx * g.gx + b.vz * g.gz : 0;
  return g;
}

/**
 * Do the body's box and the world box intersect? (on all three axes at once)
 * For a wedge, also: are the feet under its slanted top, at the footprint's
 * uphill edge? (Above the plane there's only air, even inside the box.)
 */
function overlaps(b: Body, radius: number, height: number, w: Box): boolean {
  return (
    b.x - radius < w.maxX - EPSILON &&
    b.x + radius > w.minX + EPSILON &&
    b.y < w.maxY - EPSILON &&
    b.y + height > w.minY + EPSILON &&
    b.z - radius < w.maxZ - EPSILON &&
    b.z + radius > w.minZ + EPSILON &&
    (!w.rise || b.y < surfaceAt(w, b.x, b.z, radius) - EPSILON)
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
    // A slope you'd walk UP going that way is a floor, not a wall (its other
    // faces, the gable's triangle and the tall end, are walls).
    const isWall = (w: Box) => !w.rise || !uphill(w, dx, dz);
    if (boxes.some((w) => isWall(w) && overlaps(lifted, radius, height - 0.1, w))) {
      return { nx: -dx, nz: -dz };
    }
  }
  return null;
}

/** Does moving along (dx, dz) climb this wedge's slope? */
function uphill(w: Box, dx: number, dz: number): boolean {
  switch (w.rise) {
    case 'east': return dx > 0;
    case 'west': return dx < 0;
    case 'south': return dz > 0;
    case 'north': return dz < 0;
    default: return false;
  }
}
