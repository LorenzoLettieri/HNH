// Eye-bat ("Malocchio") AI: a flying eyeball with bat wings.
// It doesn't use the navigation graph: it flies. Each tick it picks a point
// in the air where it would like to be (on a circle around the player, a few
// meters up) and steers toward it, "boids" style:
//   desired velocity = (where I want to be − where I am), capped at my speed
//   velocity        += (desired − velocity) × accel × dt     (smooth turns)
// plus a push away from other eye-bats, and a hop upward when something is
// in the way. Collisions with the level use the same moveAndCollide as
// everything else, so it slides along walls instead of going through them.
import { moveAndCollide, overlapsAny } from './collision';
import { tuning } from './config';
import type { Entity, EyebatEntity } from './entities';
import type { PlayerState } from './player';
import type { World } from './world';

/** How far ahead (in seconds of flight) it looks for obstacles. */
const LOOKAHEAD = 0.5;
/** Gravity on a dead eye-bat, m/s² (same feel as everything else falling). */
const FALL_GRAVITY = 20;

export function stepEyebat(
  b: EyebatEntity,
  player: PlayerState,
  others: Entity[],
  world: World,
  dt: number,
): void {
  b.stateTicks++;
  const r = tuning.eyebatRadius;
  const size = r * 2;

  if (b.state === 'dead') {
    // Wings stop: it drops like a stone (keeping a bit of its momentum).
    b.vx *= 0.98;
    b.vz *= 0.98;
    b.vy -= FALL_GRAVITY * dt;
    const { landed } = moveAndCollide(b, r, size, world.boxes, dt);
    if (landed) {
      b.vx = 0;
      b.vz = 0;
    }
    return;
  }

  // --- 1. Where would I like to be? ---------------------------------------
  // Angle around the player, measured from the player to me (atan2 = the
  // angle of a 2D vector, like in a polar coordinate system).
  const angle = Math.atan2(b.z - player.z, b.x - player.x);
  // Aim a bit further along the circle: chasing a point that keeps moving
  // ahead of you makes you circle. orbitSide decides clockwise or not.
  const ahead = angle + b.orbitSide * Math.max(0.15, tuning.eyebatOrbitSpeed);
  // A slow up/down drift so a group doesn't fly at one exact height.
  // Based on the tick count (b.stateTicks) and the id: deterministic.
  const drift = Math.sin(b.stateTicks * 0.03 + b.id) * 1.2;
  const goalX = player.x + Math.cos(ahead) * tuning.eyebatOrbitDistance;
  const goalZ = player.z + Math.sin(ahead) * tuning.eyebatOrbitDistance;
  const goalY = player.y + tuning.eyebatHoverHeight + drift - r; // b.y is the bottom of the body

  // --- 2. Desired velocity: toward the goal, slowing down near it ----------
  let wx = goalX - b.x;
  let wy = goalY - b.y;
  let wz = goalZ - b.z;
  const dist = Math.hypot(wx, wy, wz);
  // "Arrive" behaviour: full speed when far, slower within 3 m, so it
  // doesn't overshoot and wobble around the goal.
  const speed = tuning.eyebatSpeed * Math.min(1, dist / 3);
  if (dist > 0.001) {
    wx = (wx / dist) * speed;
    wy = (wy / dist) * speed;
    wz = (wz / dist) * speed;
  }

  // --- 3. Separation from other eye-bats (in 3D: they also stack up/down) --
  for (const o of others) {
    if (o === b || o.type !== 'eyebat' || o.state === 'dead') continue;
    const ox = b.x - o.x;
    const oy = b.y - o.y;
    const oz = b.z - o.z;
    const d = Math.hypot(ox, oy, oz);
    if (d > 0.001 && d < tuning.eyebatSeparation) {
      const push = ((tuning.eyebatSeparation - d) / tuning.eyebatSeparation) * tuning.eyebatSpeed;
      wx += (ox / d) * push;
      wy += (oy / d) * push;
      wz += (oz / d) * push;
    }
  }

  // --- 4. Obstacle ahead? Fly over it. --------------------------------------
  // Probe where we'd be in LOOKAHEAD seconds at the current velocity: if
  // that spot is inside a box, add a strong upward wish. Simple, and roofs
  // and walls are all boxes we can go over.
  const aheadX = b.x + b.vx * LOOKAHEAD;
  const aheadZ = b.z + b.vz * LOOKAHEAD;
  if (overlapsAny(aheadX, b.y, aheadZ, r, size, world.boxes)) wy = Math.max(wy, tuning.eyebatSpeed);

  // --- 5. Steer: turn the velocity toward the wish, a bit each tick --------
  const k = Math.min(1, tuning.eyebatAccel * dt);
  b.vx += (wx - b.vx) * k;
  b.vy += (wy - b.vy) * k;
  b.vz += (wz - b.vz) * k;

  moveAndCollide(b, r, size, world.boxes, dt);
}
