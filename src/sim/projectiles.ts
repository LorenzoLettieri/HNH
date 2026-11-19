// Enemy projectiles: slow, visible balls (the eye-bat's fireballs, and in
// the future the gunslinger's or dynamiter's). Unlike the revolver they are
// NOT hitscan: each one is a little object that moves a bit every tick, so
// you can see it coming and step out of the way.
//
// They are not entities: you can't shoot them and they have no health. They
// live in their own list in the GameState, as plain data (serializable).
import { tuning } from './config';
import type { SimEvent } from './events';
import { currentHeight, hurtPlayer, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

export interface Projectile {
  id: number;
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

    // 1. The level. A ball at 12 m/s moves 20 cm per tick: we cast a ray
    //    along that little segment instead of just checking the new point.
    //    Checking only the point could "tunnel" through a thin plank (one
    //    tick in front of it, the next tick already behind it).
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    const step = speed * dt;
    const dx = p.vx / speed;
    const dy = p.vy / speed;
    const dz = p.vz / speed;
    const wall = raycastBoxes(p.x, p.y, p.z, dx, dy, dz, step, world.boxes);
    if (wall) {
      events.push({ type: 'projectileHit', x: wall.x, y: wall.y, z: wall.z, nx: wall.nx, ny: wall.ny, nz: wall.nz, player: false });
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;

    // 2. The player: sphere against box. Find the point of the player's box
    //    closest to the ball's center (clamp each coordinate into the box),
    //    then it's a hit if that point is closer than the ball's radius.
    if (player.health > 0) {
      const r = tuning.playerRadius;
      const cx = clamp(p.x, player.x - r, player.x + r);
      const cy = clamp(p.y, player.y, player.y + currentHeight(player));
      const cz = clamp(p.z, player.z - r, player.z + r);
      if (Math.hypot(p.x - cx, p.y - cy, p.z - cz) < tuning.projectileRadius) {
        const damage = tuning.eyebatProjectileDamage;
        // Pushed along the ball's flight: "from" is a point behind it.
        hurtPlayer(player, damage, p.x - dx, p.z - dz, tuning.eyebatProjectileKnockback);
        events.push({ type: 'playerHurt', damage, fromX: p.x - dx * 5, fromZ: p.z - dz * 5 });
        events.push({ type: 'projectileHit', x: p.x, y: p.y, z: p.z, nx: -dx, ny: -dy, nz: -dz, player: true });
        continue;
      }
    }

    if (p.ticksLeft > 0) alive.push(p);
  }
  return alive;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
