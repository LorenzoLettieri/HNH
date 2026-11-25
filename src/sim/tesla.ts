// The TESLA: the carbine reinforced at the Forge (docs/DESIGN.md §6d).
// Its bullet is electric: where it hits an enemy, a spark jumps to the
// nearest other enemy, then from that one to the next, and so on: a chain
// (a "chain lightning", like CoD's Wunderwaffe, but weaker: few jumps,
// a short reach, less damage at every jump).
// Every enemy in the chain (the first one too) takes a jolt and is STUNNED
// for a moment, with the same stun as the drink "Zoccolo duro" (status.ts:
// no AI, only physics). The Damned Smith takes the damage but doesn't stop:
// a boss frozen by a gun would be no boss.
//
// The chain is GREEDY: at every jump it takes the nearest enemy not yet hit,
// in sight (no sparks through walls). It doesn't look for the best path
// through all of them: the nearest is what lightning does, and it's cheap.
import { secondsToTicks, tuning } from './config';
import { isAlive, isEnemy, type Entity } from './entities';
import type { SimEvent } from './events';
import { applyGunDamage, hitCenter, lineFree } from './gunDamage';
import type { PlayerState } from './player';
import type { World } from './world';

type Point = { x: number; y: number; z: number };

/**
 * The chain from an enemy just hit by a Tesla bullet. `shotDamage` = the
 * bullet's base damage (forge included, not the critical): the jolts are a
 * share of it, so they follow the gun's power and not a fixed number that
 * the enemies' health would leave behind after a few waves.
 * Pushes one 'teslaArc' event with the points of the chain (for the
 * lightning on screen) and a 'hit' for every jolt.
 */
export function teslaChain(
  p: PlayerState,
  from: Point,
  first: Entity,
  shotDamage: number,
  world: World,
  entities: Entity[],
  events: SimEvent[],
): void {
  teslaStun(first);
  const points: Point[] = [from];
  const struck = new Set<Entity>([first]);
  let at = hitCenter(first);
  let amount = shotDamage * tuning.teslaArcShare;
  for (let jump = 0; jump < tuning.teslaArcJumps; jump++) {
    const next = nearestInReach(at, struck, world, entities);
    if (!next) break;
    struck.add(next);
    const c = hitCenter(next);
    points.push(c);
    // Distance from YOU (the style's "long shot" and the score read it), not from the previous enemy.
    applyGunDamage(next, amount, false, 'rifle', Math.hypot(c.x - p.x, c.z - p.z), events);
    teslaStun(next);
    at = c;
    amount *= tuning.teslaArcFalloff;
  }
  // Only the impact point: no jump, no lightning to draw (the first jolt is the bullet itself).
  if (points.length > 1) events.push({ type: 'teslaArc', points, entityIds: [...struck].map((e) => e.id) });
}

/** The nearest living enemy within teslaArcRange of `at`, not struck yet, in sight. */
function nearestInReach(at: Point, struck: Set<Entity>, world: World, entities: Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestDistance = tuning.teslaArcRange;
  for (const e of entities) {
    if (struck.has(e) || !isEnemy(e) || !isAlive(e)) continue;
    const c = hitCenter(e);
    const d = Math.hypot(c.x - at.x, c.y - at.y, c.z - at.z);
    if (d < bestDistance && lineFree(world, at.x, at.y, at.z, c.x, c.y, c.z)) {
      best = e;
      bestDistance = d;
    }
  }
  return best;
}

/** The jolt's stun (never shorter than a stun already running, e.g. from the boot). */
function teslaStun(e: Entity): void {
  if (!isEnemy(e) || !isAlive(e) || e.type === 'smith') return;
  e.stunTicks = Math.max(e.stunTicks ?? 0, secondsToTicks(tuning.teslaStunTime));
}
