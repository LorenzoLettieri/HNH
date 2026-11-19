// Eye-bat ("Malocchio") AI: a flying eyeball with bat wings.
// It doesn't use the navigation graph: it flies. Each tick it picks a point
// in the air where it would like to be (on a circle around the player, a few
// meters up) and steers toward it, "boids" style:
//   desired velocity = (where I want to be − where I am), capped at my speed
//   velocity        += (desired − velocity) × accel × dt     (smooth turns)
// plus a push away from other eye-bats, and a hop upward when something is
// in the way. Collisions with the level use the same moveAndCollide as
// everything else, so it slides along walls instead of going through them.
//
// Shooting is a tiny state machine:
//   fly ──(cooldown over, you're in range and in sight)──▶ charge
//   charge ──(after eyebatChargeTime)──▶ fires a fireball ──▶ fly
// The fireball is aimed where you WILL be (see fire()): moving is not
// enough, you must change direction.
// The charge is the WARNING (docs/DESIGN.md, "leggibilità"): you see the eye
// blaze and hear the whine before the shot, so getting hit is your fault.
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, tuning } from './config';
import type { EyebatEntity } from './entities';
import type { SimEvent } from './events';
import type { GameState } from './game';
import { currentHeight, currentEyeHeight } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

/** How far ahead (in seconds of flight) it looks for obstacles. */
const LOOKAHEAD = 0.5;
/** Gravity on a dead eye-bat, m/s² (same feel as everything else falling). */
const FALL_GRAVITY = 20;

/** While charging it slows down to this fraction of its speed (it "aims"). */
const CHARGE_SLOWDOWN = 0.25;

export function stepEyebat(b: EyebatEntity, game: GameState, world: World, dt: number, events: SimEvent[]): void {
  const player = game.player;
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
  const speed = tuning.eyebatSpeed * Math.min(1, dist / 3) * (b.state === 'charge' ? CHARGE_SLOWDOWN : 1);
  if (dist > 0.001) {
    wx = (wx / dist) * speed;
    wy = (wy / dist) * speed;
    wz = (wz / dist) * speed;
  }

  // --- 3. Separation from other eye-bats (in 3D: they also stack up/down) --
  for (const o of game.entities) {
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
  // Probe a point ahead in the direction it WANTS to go (at least 1 m): if
  // that spot is inside a box, add a strong upward wish. Simple, and roofs
  // and walls are all boxes we can go over.
  // (Not along its current velocity: pressed against a wall, collisions
  // zero the velocity, the probe would stay where it is and never see the
  // wall. It would stay stuck there forever.)
  const wishH = Math.hypot(wx, wz);
  if (wishH > 0.001) {
    const ahead = Math.max(1, wishH * LOOKAHEAD);
    const aheadX = b.x + (wx / wishH) * ahead;
    const aheadZ = b.z + (wz / wishH) * ahead;
    if (overlapsAny(aheadX, b.y, aheadZ, r, size, world.boxes)) wy = Math.max(wy, tuning.eyebatSpeed);
  }

  // --- 5. Steer: turn the velocity toward the wish, a bit each tick --------
  const k = Math.min(1, tuning.eyebatAccel * dt);
  b.vx += (wx - b.vx) * k;
  b.vy += (wy - b.vy) * k;
  b.vz += (wz - b.vz) * k;

  moveAndCollide(b, r, size, world.boxes, dt);

  // --- 6. Shooting -----------------------------------------------------------
  if (b.shootCooldownTicks > 0) b.shootCooldownTicks--;
  if (b.state === 'fly' && b.shootCooldownTicks === 0 && player.health > 0 && canSee(b, game, world)) {
    b.state = 'charge';
    b.stateTicks = 0;
    events.push({ type: 'eyebatCharge', entityId: b.id });
  } else if (b.state === 'charge' && b.stateTicks >= secondsToTicks(tuning.eyebatChargeTime)) {
    fire(b, game, events);
    b.state = 'fly';
    b.stateTicks = 0;
    // Next shot: the interval plus 0-1 s of variation. "Random" but
    // deterministic (from the id and the tick), like the rest of the sim.
    const jitter = ((b.id * 37 + game.tick) % 60) / 60;
    b.shootCooldownTicks = secondsToTicks(tuning.eyebatShootInterval + jitter);
  }
}

/** Center of the eye (b.y is the bottom of the body). */
function eyeY(b: EyebatEntity): number {
  return b.y + tuning.eyebatRadius;
}

/** Are you in range, with no wall between its eye and yours? */
function canSee(b: EyebatEntity, game: GameState, world: World): boolean {
  const p = game.player;
  const dx = p.x - b.x;
  const dy = p.y + currentEyeHeight(p) - eyeY(b);
  const dz = p.z - b.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > tuning.eyebatShootRange || dist < 0.001) return false;
  // Line of sight: a ray from its eye to yours. If it hits a box first, it can't see you.
  return raycastBoxes(b.x, eyeY(b), b.z, dx / dist, dy / dist, dz / dist, dist, world.boxes) === null;
}

/**
 * Fires a fireball where you WILL be ("leading the shot", like a hunter
 * aiming ahead of a flying duck). Keep going straight at the same speed and
 * it gets you; change direction after the warning and it misses.
 * How far ahead it aims is tuning.eyebatLeadFactor (0 = where you are now).
 */
function fire(b: EyebatEntity, game: GameState, events: SimEvent[]): void {
  const p = game.player;
  const sx = b.x;
  const sy = eyeY(b);
  const sz = b.z;
  const v = tuning.eyebatProjectileSpeed;
  // Where you are now (your chest)...
  const px = p.x;
  const py = p.y + currentHeight(p) * 0.6;
  const pz = p.z;
  // ...and when the ball would reach you if you kept your current velocity.
  // Only the horizontal velocity: a jump is a curve, not a straight line,
  // and leading it would make the ball fly over your head.
  const t = interceptTime(px - sx, py - sy, pz - sz, p.vx, 0, p.vz, v) * tuning.eyebatLeadFactor;
  const dx = px + p.vx * t - sx;
  const dy = py - sy;
  const dz = pz + p.vz * t - sz;
  const d = Math.hypot(dx, dy, dz) || 1;
  const id = game.nextEntityId++; // same counter as the entities: ids are unique game-wide
  game.projectiles.push({
    id,
    x: sx,
    y: sy,
    z: sz,
    px: sx,
    py: sy,
    pz: sz,
    vx: (dx / d) * v,
    vy: (dy / d) * v,
    vz: (dz / d) * v,
    ticksLeft: secondsToTicks(tuning.projectileLifetime),
  });
  events.push({ type: 'eyebatShot', entityId: b.id, projectileId: id });
}

/**
 * Intercept: after how many seconds can a ball fired at `speed` meet a target
 * that is now at offset (rx, ry, rz) and moves with velocity (vx, vy, vz)?
 * The target at time t is at r + v·t; the ball covers speed·t. They meet when
 *     |r + v·t| = speed·t
 * Squaring both sides gives a quadratic equation  a·t² + b·t + c = 0  with
 *     a = v·v − speed²,   b = 2·(r·v),   c = r·r
 * (the "·" between vectors is the dot product). We want the smallest
 * positive solution. No solution (target faster than the ball, running
 * away): we fall back to the time it takes to cover the current distance.
 */
function interceptTime(rx: number, ry: number, rz: number, vx: number, vy: number, vz: number, speed: number): number {
  const a = vx * vx + vy * vy + vz * vz - speed * speed;
  const b = 2 * (rx * vx + ry * vy + rz * vz);
  const c = rx * rx + ry * ry + rz * rz;
  const fallback = Math.sqrt(c) / speed;
  if (Math.abs(a) < 1e-6) return b < 0 ? -c / b : fallback; // target as fast as the ball: linear
  const disc = b * b - 4 * a * c;
  if (disc < 0) return fallback;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
  // Capped: never aim absurdly far ahead (projectileLifetime would expire anyway).
  return Number.isFinite(t) ? Math.min(t, 3) : fallback;
}
