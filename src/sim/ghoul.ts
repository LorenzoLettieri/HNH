// Ghoul AI: the basic horde enemy (think CoD zombies). It walks straight at
// you, hops over low obstacles, goes around tall ones, and keeps a little
// distance from its friends so the horde spreads instead of stacking.
// (Climbing onto rooftops needs a navigation graph: a future step.)
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, tuning } from './config';
import type { GhoulEntity, Entity } from './entities';
import type { PlayerState } from './player';
import type { World } from './world';

/** Turn a direction (x, z) by `angle` radians around the vertical axis. */
function rotate(x: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - z * s, x * s + z * c];
}

export function stepGhoul(
  g: GhoulEntity,
  player: PlayerState,
  others: Entity[],
  world: World,
  dt: number,
): void {
  g.stateTicks++;
  if (g.attackCooldownTicks > 0) g.attackCooldownTicks--;
  if (g.detourTicks > 0) g.detourTicks--;

  // --- Where does it want to go? ---
  let wishX = 0;
  let wishZ = 0;
  if (g.state === 'chase') {
    const dx = player.x - g.x;
    const dz = player.z - g.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.01) {
      wishX = dx / dist;
      wishZ = dz / dist;
    }
    // Going around an obstacle: walk almost parallel to it (~85° from the
    // direct line), always on the same side, until the way is clear.
    if (g.detourTicks > 0) [wishX, wishZ] = rotate(wishX, wishZ, g.detourSide * 1.5);

    // Separation: a push away from every ghoul that's too close, stronger the
    // closer it is. Classic "boids" steering: each one only looks at its
    // neighbors, and the crowd spreads out on its own.
    for (const o of others) {
      if (o === g || o.type !== 'ghoul' || o.state === 'dead') continue;
      const ox = g.x - o.x;
      const oz = g.z - o.z;
      const d = Math.hypot(ox, oz);
      if (d > 0.001 && d < tuning.ghoulSeparation) {
        const push = (tuning.ghoulSeparation - d) / tuning.ghoulSeparation;
        wishX += (ox / d) * push * 1.5;
        wishZ += (oz / d) * push * 1.5;
      }
    }
  }

  // --- Accelerate toward the wished velocity (no Quake tricks for them) ---
  const speed = g.state === 'chase' ? tuning.ghoulSpeed : 0;
  const len = Math.hypot(wishX, wishZ);
  const targetVx = len > 0 ? (wishX / len) * speed : 0;
  const targetVz = len > 0 ? (wishZ / len) * speed : 0;
  const k = Math.min(1, tuning.ghoulAccel * dt);
  if (g.onGround) {
    g.vx += (targetVx - g.vx) * k;
    g.vz += (targetVz - g.vz) * k;
  }
  g.vy -= tuning.gravity * dt;

  // --- Move with collisions (the same code the player uses) ---
  const wantedSpeed = Math.hypot(targetVx, targetVz);
  const speedBefore = Math.hypot(g.vx, g.vz);
  const { landed } = moveAndCollide(g, tuning.ghoulRadius, tuning.ghoulHeight, world.boxes, dt);
  g.onGround = landed;

  // --- Blocked? Hop over it if it's low, otherwise go around it ---
  // "Blocked" = the COLLISION stopped us (we were moving, now we aren't).
  // Not just "slow": a ghoul that's just starting to walk is slow too.
  const speedAfter = Math.hypot(g.vx, g.vz);
  // (Pushing against a wall, the collision zeroes our speed every tick, so
  // speedBefore stays small: the threshold must be low.)
  const blocked = speedBefore > 0.2 && speedAfter < speedBefore * 0.5;
  if (g.state === 'chase' && g.onGround && wantedSpeed > 0.5 && blocked) {
    const aheadX = g.x + (targetVx / wantedSpeed) * 0.4;
    const aheadZ = g.z + (targetVz / wantedSpeed) * 0.4;
    const r = tuning.ghoulRadius;
    // Is there room for its body a jump-height higher, just ahead?
    const lowObstacle = !overlapsAny(aheadX, g.y + tuning.ghoulJumpHeight, aheadZ, r, tuning.ghoulHeight, world.boxes);
    if (lowObstacle) {
      g.vy = Math.sqrt(2 * tuning.gravity * (tuning.ghoulJumpHeight + 0.15));
      g.onGround = false;
    } else {
      // Start (or keep extending) the detour. The side stays the same: a ghoul
      // that picked "left" follows the wall to the left until it rounds the
      // corner (flipping at random would make it dither in place)...
      g.detourTicks = secondsToTicks(1.2);
      // ...unless it stays stuck for a while: then it's in a dead end
      // (a corner), and the other way is the only way out.
      g.stuckTicks++;
      if (g.stuckTicks > secondsToTicks(1.5)) {
        g.detourSide = -g.detourSide;
        g.stuckTicks = 0;
      }
    }
  } else if (speedAfter > wantedSpeed * 0.6) {
    g.stuckTicks = 0; // moving freely again
  }

  // --- Attack when close (the damage itself comes in a later step) ---
  const distToPlayer = Math.hypot(player.x - g.x, player.z - g.z);
  if (g.state === 'chase' && distToPlayer < tuning.ghoulAttackRange && g.attackCooldownTicks === 0) {
    g.state = 'attack';
    g.stateTicks = 0;
  }
  if (g.state === 'attack' && g.stateTicks >= secondsToTicks(tuning.ghoulAttackTime)) {
    g.state = 'chase';
    g.stateTicks = 0;
    g.attackCooldownTicks = secondsToTicks(tuning.ghoulAttackCooldown);
  }
}
