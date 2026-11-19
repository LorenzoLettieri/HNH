// Body blocking: enemies are solid for the player, CoD Zombies style.
// You can't sprint through the horde: to get out of a bad spot you go
// AROUND (strafe), OVER (jump, wall jump) or make a hole (kick, shotgun).
import { moveAndCollide } from './collision';
import { tuning } from './config';
import type { Entity } from './entities';
import type { PlayerState } from './player';
import type { World } from './world';

/** Collider of an enemy body: a vertical cylinder (radius + height), or null = not solid. */
function bodyOf(e: Entity): { radius: number; height: number } | null {
  if (e.type === 'ghoul' || e.type === 'hound') {
    // Dead or knocked down (flying / lying on the ground): you walk over it.
    if (e.state === 'dead' || e.state === 'staggered') return null;
    return e.type === 'ghoul'
      ? { radius: tuning.ghoulRadius, height: tuning.ghoulHeight }
      : { radius: tuning.houndRadius, height: tuning.houndHeight };
  }
  if (e.type === 'sharpshooter') {
    if (e.state === 'dead') return null;
    return { radius: tuning.sharpshooterRadius, height: tuning.sharpshooterHeight };
  }
  if (e.type === 'bull') {
    if (e.state === 'dead') return null;
    return { radius: tuning.bullRadius, height: tuning.bullHeight };
  }
  // Targets have their own (non-)physics, eye-bats fly: not solid.
  return null;
}

/**
 * Pushes the player out of every enemy body they overlap.
 *
 * Here the bodies are CYLINDERS (circles seen from above), not boxes like the
 * level: the push goes along the line between the two centers, so you slide
 * AROUND an enemy smoothly instead of catching on a corner. Only the player
 * moves: enemies are "heavy" (as in CoD, you can't shove a zombie aside).
 *
 * Called after the enemies moved, so it also handles an enemy walking into
 * you: the horde presses on you, and walls stop the push (no clipping).
 */
export function blockPlayerWithBodies(player: PlayerState, entities: Entity[], world: World, dt: number): void {
  if (!tuning.enemyBodyBlock) return;
  const playerHeight = player.crouched ? tuning.crouchHeight : tuning.playerHeight;

  // Sum all the corrections first, then apply them once: with several
  // enemies around you the pushes add up (squeezed between two = pushed to the gap).
  let pushX = 0;
  let pushZ = 0;
  for (const e of entities) {
    const body = bodyOf(e);
    if (!body) continue;
    // Vertical check: no overlap if you're above its head (you jumped over
    // it) or it's above yours (it's on a balcony).
    if (player.y >= e.y + body.height || e.y >= player.y + playerHeight) continue;

    const dx = player.x - e.x;
    const dz = player.z - e.z;
    const dist = Math.hypot(dx, dz);
    const minDist = tuning.playerRadius + body.radius;
    if (dist >= minDist) continue;

    // Direction to push along: from its center to ours. Exactly on top of
    // each other (rare) → any direction, here the one the player is looking.
    const nx = dist > 1e-4 ? dx / dist : -Math.sin(player.yaw);
    const nz = dist > 1e-4 ? dz / dist : -Math.cos(player.yaw);
    const overlap = minDist - dist;
    pushX += nx * overlap;
    pushZ += nz * overlap;

    // Like hitting a wall: cancel the part of your velocity going INTO it
    // (dot product with the normal), keep the part going along it.
    const into = player.vx * nx + player.vz * nz;
    if (into < 0) {
      player.vx -= into * nx;
      player.vz -= into * nz;
    }
  }
  if (pushX === 0 && pushZ === 0) return;

  // Apply the push as a tiny move through the level's collision, so an enemy
  // can't shove you into a wall: a temporary body with velocity = push / dt
  // moves exactly `push` meters in one dt (unless a wall stops it).
  const probe = { x: player.x, y: player.y, z: player.z, vx: pushX / dt, vy: 0, vz: pushZ / dt };
  moveAndCollide(probe, tuning.playerRadius, playerHeight, world.boxes, dt);
  player.x = probe.x;
  player.z = probe.z;
}
