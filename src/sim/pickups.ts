// Pickups: things lying on the ground that you collect by walking over them.
// For now they only come from killed enemies ("drops"), and there are three kinds:
// - BULLETS: spare rounds for the revolver;
// - SHELLS: spare shells for the shotgun;
// - MEDKIT: health (the only way to heal: there's no regeneration).
// Ammo is split ON PURPOSE: if the shells don't come for a while, you're
// forced to play with the revolver (and the other way around).
//
// Drops are GENERIC, not a loot table per enemy: the chance of a drop grows
// with the enemy's weight (the same `*Cost` the waves use), so a hound (3)
// drops something more often than a ghoul (1). Then a second roll decides
// what: a "weighted" choice (see pickKind).
//
// Drops VANISH after a while: one more reason to keep moving (and to dive
// into the fight to grab them).
//
// Pure simulation, like everything in src/sim: the renderer reads the list.
import { secondsToTicks, tuning } from './config';
import type { SimEvent } from './events';
import type { Entity } from './entities';
import type { GameState } from './game';
import { random } from './random';
import { raycastBoxes } from './raycast';
import { enemyCost } from './waves';
import type { WeaponId } from './weapon';
import type { World } from './world';

export type PickupKind = 'bullets' | 'shells' | 'medkit';

/** Which weapon's pockets each kind of ammo fills. */
const AMMO_FOR: Record<Exclude<PickupKind, 'medkit'>, WeaponId> = { bullets: 'revolver', shells: 'shotgun' };

export interface Pickup {
  /** Unique (shares the counter with the entities): the renderer keeps one mesh per id. */
  id: number;
  kind: PickupKind;
  /** Position: on the floor. */
  x: number;
  y: number;
  z: number;
  /** Ticks left before it vanishes. */
  ticksLeft: number;
}

/**
 * Looks at this tick's events and maybe drops something where each enemy died.
 * Kills come from the 'hit' events (killed = true) that weapons and the kick
 * already emit: we don't touch the weapon code at all, we just listen.
 */
export function dropFromKills(game: GameState, world: World, events: SimEvent[]): void {
  for (const ev of events) {
    if (ev.type !== 'hit' || !ev.killed) continue;
    const enemy = game.entities.find((e) => e.id === ev.entityId);
    if (!enemy || enemy.type === 'target') continue; // steel targets drop nothing
    // Chance = weight × dropChancePerWeight, capped. Ghoul 1 → 20%, eye-bat 2 → 40%, hound 3 → 60%.
    const chance = Math.min(tuning.dropChanceMax, enemyCost(enemy) * tuning.dropChancePerWeight);
    if (random(game) >= chance) continue;
    const kind = pickKind(random(game));
    const floor = floorBelow(enemy, world);
    if (floor === null) continue; // died over a pit: the drop would fall forever
    game.pickups.push({
      id: game.nextEntityId++,
      kind,
      x: enemy.x,
      y: floor,
      z: enemy.z,
      ticksLeft: secondsToTicks(tuning.dropLifetime),
    });
  }
}

/**
 * Weighted random choice. Each kind has a weight (dropWeight* in config.ts):
 * line them up one after the other, like segments on a ruler of total length
 * = sum of the weights, throw a dart (`roll` × total) and see which segment
 * it lands in. Bullets 4, shells 3, medkit 3 → 40%, 30%, 30%. Weights instead
 * of percentages: you can change one without having to fix the others to
 * make 100. (Loot tables in every game work like this.)
 */
function pickKind(roll: number): PickupKind {
  const weights: [PickupKind, number][] = [
    ['bullets', tuning.dropWeightBullets],
    ['shells', tuning.dropWeightShells],
    ['medkit', tuning.dropWeightMedkit],
  ];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let dart = roll * total;
  for (const [kind, w] of weights) {
    if (dart < w) return kind;
    dart -= w;
  }
  return weights[weights.length - 1][0]; // only reached if every weight is 0
}

/**
 * Where's the floor under a dead enemy? An eye-bat dies in the air, a ghoul
 * may die flying from a kick: instead of simulating the fall, we cast a ray
 * straight down (the same raycast as the bullets) and put the drop where it hits.
 * The ray starts a bit above the feet, so a body slightly inside the floor still works.
 */
function floorBelow(e: Entity, world: World): number | null {
  const hit = raycastBoxes(e.x, e.y + 0.5, e.z, 0, -1, 0, 200, world.boxes);
  return hit ? hit.y : null;
}

/** Every tick: pickups age (and vanish), and the player collects the ones touching them. */
export function stepPickups(game: GameState, events: SimEvent[]): void {
  const p = game.player;
  game.pickups = game.pickups.filter((d) => {
    if (--d.ticksLeft <= 0) return false;
    // Touching: close enough horizontally (a cylinder around the player, a bit
    // generous: you're running, you shouldn't have to stop on top of it),
    // and between the feet (minus a little) and the head.
    const near = Math.hypot(d.x - p.x, d.z - p.z) < tuning.pickupRadius;
    const level = d.y > p.y - 0.5 && d.y < p.y + tuning.playerHeight;
    if (!near || !level) return true;
    // Doom rule: if you don't need it, it stays on the ground (for later).
    if (!collect(game, d.kind)) return true;
    events.push({ type: 'pickup', kind: d.kind, x: d.x, y: d.y, z: d.z });
    return false;
  });
}

/** Gives the pickup to the player. Returns false if it would be wasted entirely. */
function collect(game: GameState, kind: PickupKind): boolean {
  const p = game.player;
  if (kind === 'medkit') {
    if (p.health >= tuning.playerMaxHealth) return false;
    p.health = Math.min(tuning.playerMaxHealth, p.health + tuning.medkitHeal);
    return true;
  }
  // Ammo: rounds for one weapon, up to what its pockets hold.
  const weapon = AMMO_FOR[kind];
  const max = weapon === 'shotgun' ? tuning.shotgunReserveMax : tuning.revolverReserveMax;
  if (p.reserve[weapon] >= max) return false;
  const amount = kind === 'shells' ? tuning.ammoPickupShells : tuning.ammoPickupBullets;
  p.reserve[weapon] = Math.min(max, p.reserve[weapon] + amount);
  return true;
}
