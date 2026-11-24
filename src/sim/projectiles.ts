// Enemy projectiles: the eye-bat's slow fireballs and the sharpshooter's
// fast bullets (in the future the dynamiter's sticks too). Unlike the
// revolver they are NOT hitscan: each one is a little object that moves a
// bit every tick, so you can see it coming (or at least have a moment to
// step out of the way).
//
// They are not entities: you can't shoot them and they have no health. They
// live in their own list in the GameState, as plain data (serializable).
import { hitBox, isAlive, isEnemy, type Entity } from './entities';
import { applyGunDamage } from './gunDamage';
import { projectileDamageScale } from './drinks';
import { tuning } from './config';
import type { SimEvent } from './events';
import { currentHeight, hurtPlayer, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { Box, World } from './world';

export interface Projectile {
  id: number;
  /** What it is (only the renderer cares: a fireball sprite or a bullet tracer). */
  kind: 'fireball' | 'bullet';
  /** Damage and push (m/s) when it hits the player. */
  damage: number;
  knockback: number;
  /** Radius, meters (for hitting the player). */
  radius: number;
  /** Center of the ball. */
  x: number;
  y: number;
  z: number;
  /** Position at the previous tick (interpolation, like the entities). */
  px: number;
  py: number;
  pz: number;
  /** Velocity, m/s. Straight line, no gravity. */
  vx: number;
  vy: number;
  vz: number;
  /** Ticks before it fizzles out on its own (if it never hits anything). */
  ticksLeft: number;
  /** It already flew past you, close (a 'nearMiss' is reported once per projectile). */
  grazed?: boolean;
  /** Sent back by your melee (drink "Bobby"): now it's yours, it hits the enemies and never you. */
  friendly?: boolean;
}

/**
 * Drink "Bobby": your melee bats the enemy projectiles in front of you back
 * where you look, faster. Called when the boot or the shovel lands. Same
 * cone idea as the kick: close to your chest, and in front (dot product
 * with where you look).
 */
export function batProjectiles(projectiles: Projectile[], player: PlayerState, events: SimEvent[]): void {
  const chestY = player.y + currentHeight(player) * 0.6;
  const lx = -Math.sin(player.yaw) * Math.cos(player.pitch);
  const ly = Math.sin(player.pitch);
  const lz = -Math.cos(player.yaw) * Math.cos(player.pitch);
  for (const p of projectiles) {
    if (p.friendly) continue;
    const dx = p.x - player.x;
    const dy = p.y - chestY;
    const dz = p.z - player.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > tuning.bobbyReach) continue;
    if (d > 0.5 && (dx * lx + dy * ly + dz * lz) / d < 0.2) continue; // behind you
    const speed = Math.hypot(p.vx, p.vy, p.vz) * tuning.bobbySpeedScale;
    p.vx = lx * speed;
    p.vy = ly * speed;
    p.vz = lz * speed;
    p.friendly = true;
    p.ticksLeft = Math.max(p.ticksLeft, 180);
    events.push({ type: 'projectileBatted', x: p.x, y: p.y, z: p.z });
  }
}

/**
 * Where along this tick's segment the projectile touches a (grown) box, or
 * null. The ray alone misses one case: a body that RAN INTO the projectile
 * between two ticks. Both moving toward each other, last tick the segment
 * stopped a couple of centimeters short of the box; this tick the box has
 * moved and the projectile starts already inside it. A ray that starts
 * inside a box never "enters" it, so the slab test says nothing: it would
 * pass through (TUNNELING, the same family as the fast bullet through thin
 * planks). So: inside already = a hit right here, at distance 0.
 */
function sweepHit(
  p: Projectile,
  b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  dx: number, dy: number, dz: number, step: number,
): { distance: number } | null {
  const inside = p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY && p.z > b.minZ && p.z < b.maxZ;
  return inside ? { distance: 0 } : raycastBoxes(p.x, p.y, p.z, dx, dy, dz, step, [b as Box]);
}

/**
 * A projectile you sent back: the first enemy hitbox on its segment this tick
 * (same Minkowski trick as against you). Returns the enemy, or null.
 */
function friendlyHit(p: Projectile, entities: Entity[], dx: number, dy: number, dz: number, step: number): { target: Entity; distance: number } | null {
  let best: { target: Entity; distance: number } | null = null;
  for (const e of entities) {
    if (!isEnemy(e) || !isAlive(e)) continue;
    const b = hitBox(e);
    const grown = { minX: b.minX - p.radius, maxX: b.maxX + p.radius, minY: b.minY - p.radius, maxY: b.maxY + p.radius, minZ: b.minZ - p.radius, maxZ: b.maxZ + p.radius };
    const hit = sweepHit(p, grown, dx, dy, dz, step);
    if (hit && (!best || hit.distance < best.distance)) best = { target: e, distance: hit.distance };
  }
  return best;
}

/**
 * Moves every projectile one tick and checks what it hits.
 * Returns the ones still flying (the others hit something or expired).
 */
export function stepProjectiles(
  projectiles: Projectile[],
  player: PlayerState,
  world: World,
  dt: number,
  events: SimEvent[],
  entities: Entity[],
): Projectile[] {
  const alive: Projectile[] = [];
  for (const p of projectiles) {
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    p.ticksLeft--;

    // Where it goes this tick: a little SEGMENT, not a point. A fireball at
    // 12 m/s moves 20 cm per tick, a bullet at 90 m/s moves 1.5 m: checking
    // only the new position, the bullet would "tunnel" through you (one tick
    // in front of you, the next already behind) and through thin planks.
    // So we cast a ray along the segment and look for the FIRST thing on it.
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    const step = speed * dt;
    const dx = p.vx / speed;
    const dy = p.vy / speed;
    const dz = p.vz / speed;

    // 1. The level.
    const wall = raycastBoxes(p.x, p.y, p.z, dx, dy, dz, step, world.boxes);

    // 2. The player. A sphere moving along a segment against a box is the
    //    same as a POINT moving along the segment against the box grown by
    //    the sphere's radius on every side (the "Minkowski sum": we shrink
    //    the ball to a point and fatten the box instead). Then it's just our
    //    usual ray-box test. (Exact on the faces, slightly generous on the
    //    corners: the grown box has square corners, the real shape rounded ones.)
    // A projectile you sent back (drink "Bobby") hits the enemies, never you.
    if (p.friendly) {
      const hit = friendlyHit(p, entities, dx, dy, dz, step);
      if (hit && (!wall || hit.distance < wall.distance)) {
        applyGunDamage(hit.target, p.damage * tuning.bobbyDamageScale, false, 'kick', hit.distance, events);
        events.push({ type: 'projectileHit', kind: p.kind, x: p.x + dx * hit.distance, y: p.y + dy * hit.distance, z: p.z + dz * hit.distance, nx: -dx, ny: -dy, nz: -dz, player: false });
        continue;
      }
    }
    let hitsPlayer = false;
    if (player.health > 0 && !p.friendly) {
      const r = tuning.playerRadius + p.radius;
      const grown = {
        minX: player.x - r,
        maxX: player.x + r,
        minY: player.y - p.radius,
        maxY: player.y + currentHeight(player) + p.radius,
        minZ: player.z - r,
        maxZ: player.z + r,
      };
      const hit = sweepHit(p, grown, dx, dy, dz, step);
      // It hits you only if you come BEFORE the wall on the segment.
      hitsPlayer = hit !== null && (wall === null || hit.distance < wall.distance);
      if (hitsPlayer) {
        p.x += dx * hit!.distance;
        p.y += dy * hit!.distance;
        p.z += dz * hit!.distance;
      }
    }

    if (hitsPlayer) {
      // Pushed along the flight: "from" is a point behind it.
      // Drink "Corazza di vapore": fast enough, and the hit is halved.
      const damage = Math.round(p.damage * projectileDamageScale(player));
      hurtPlayer(player, damage, p.x - dx, p.z - dz, p.knockback);
      events.push({ type: 'playerHurt', damage, fromX: p.x - dx * 5, fromZ: p.z - dz * 5 });
      events.push({ type: 'projectileHit', kind: p.kind, x: p.x, y: p.y, z: p.z, nx: -dx, ny: -dy, nz: -dz, player: true });
      continue;
    }
    // Missed you, but by a hair? The point of this tick's segment closest to
    // your chest: project (chest - start) onto the direction (dot product),
    // clamped to the segment. If that point is INSIDE the segment (not at
    // its end), the projectile is passing you right now; at the end it's
    // still coming (next tick it might hit).
    if (!p.grazed && !p.friendly && player.health > 0) { // (a projectile you batted back is no dodge)
      const cx = player.x - p.x;
      const cy = player.y + currentHeight(player) / 2 - p.y;
      const cz = player.z - p.z;
      const t = cx * dx + cy * dy + cz * dz;
      const reach = wall ? wall.distance : step;
      if (t > 0 && t < reach) {
        const miss = Math.hypot(cx - dx * t, cy - dy * t, cz - dz * t);
        if (miss < tuning.styleNearMissDistance) {
          p.grazed = true;
          events.push({ type: 'nearMiss', kind: p.kind });
        }
      }
    }
    if (wall) {
      events.push({ type: 'projectileHit', kind: p.kind, x: wall.x, y: wall.y, z: wall.z, nx: wall.nx, ny: wall.ny, nz: wall.nz, player: false });
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;

    if (p.ticksLeft > 0) alive.push(p);
  }
  return alive;
}
