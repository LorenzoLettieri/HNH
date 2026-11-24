// Enemy projectiles: the eye-bat's slow fireballs and the sharpshooter's
// fast bullets (in the future the dynamiter's sticks too). Unlike the
// revolver they are NOT hitscan: each one is a little object that moves a
// bit every tick, so you can see it coming (or at least have a moment to
// step out of the way).
//
// They are not entities: you can't shoot them and they have no health. They
// live in their own list in the GameState, as plain data (serializable).
import { projectileDamageScale } from './drinks';
import { tuning } from './config';
import type { SimEvent } from './events';
import { currentHeight, hurtPlayer, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

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
    let hitsPlayer = false;
    if (player.health > 0) {
      const r = tuning.playerRadius + p.radius;
      const grown = {
        minX: player.x - r,
        maxX: player.x + r,
        minY: player.y - p.radius,
        maxY: player.y + currentHeight(player) + p.radius,
        minZ: player.z - r,
        maxZ: player.z + r,
      };
      const hit = raycastBoxes(p.x, p.y, p.z, dx, dy, dz, step, [grown]);
      // It hits you only if you come BEFORE the wall on the segment.
      hitsPlayer = hit !== null && (wall === null || hit.distance < wall.distance);
      if (hitsPlayer) {
        p.x = hit!.x;
        p.y = hit!.y;
        p.z = hit!.z;
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
    if (!p.grazed && player.health > 0) {
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
