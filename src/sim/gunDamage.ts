// Small pieces shared by everything the player hurts enemies with from a
// distance: the guns (weapon.ts), the explosions (explosion.ts) and the
// dynamite sticks (dynamite.ts). They lived in weapon.ts; they moved here
// when the explosions needed them too, so that explosion.ts doesn't import
// weapon.ts and weapon.ts doesn't import explosion.ts (a circle of imports).
import type { SimEvent, HitSource } from './events';
import { damage, hitBox, isEnemy, type Entity } from './entities';
import { raycastBoxes } from './raycast';
import type { World } from './world';

/** Deals damage to an entity hit by a gun (or an explosion) and reports it (hitmarker, score, sounds). */
export function applyGunDamage(
  target: Entity,
  amount: number,
  headshot: boolean,
  source: HitSource,
  distance: number,
  events: SimEvent[],
): void {
  const killed = damage(target, amount);
  if (killed && headshot && (target.type === 'ghoul' || target.type === 'sharpshooter')) target.headless = true;
  if (killed && headshot && target.type === 'eyebat') target.popped = true;
  events.push({
    type: 'hit',
    entityId: target.id,
    damage: amount,
    killed,
    surface: isEnemy(target) ? 'flesh' : 'metal',
    headshot,
    source,
    distance,
    target: target.type,
  });
}

/** Is the straight line from a to b free of level boxes? (Explosions and ricochets don't go through walls.) */
export function lineFree(world: World, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return raycastBoxes(ax, ay, az, dx / len, dy / len, dz / len, len, world.boxes) === null;
}

/** Center of an entity's hitbox: where a ricochet aims, and where an explosion's wall check aims. */
export function hitCenter(e: Entity): { x: number; y: number; z: number } {
  const b = hitBox(e);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 };
}
