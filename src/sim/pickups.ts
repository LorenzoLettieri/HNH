// Pickups: things lying on the ground that you collect by walking over them.
// For now they only come from killed enemies ("drops"), and there are two kinds:
// - AMMO: a box with spare rounds for BOTH weapons (one kind, no choice to
//   think about mid-fight);
// - MEDKIT: health (the only way to heal: there's no regeneration).
//
// Drops are GENERIC, not a loot table per enemy: the chance of a drop grows
// with the enemy's weight (the same `*Cost` the waves use), so a hound (3)
// drops something more often than a ghoul (1). Then a second roll decides
// ammo or medkit.
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
import type { World } from './world';

export type PickupKind = 'ammo' | 'medkit';

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
    const kind: PickupKind = random(game) < tuning.dropMedkitShare ? 'medkit' : 'ammo';
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
  // Ammo: rounds for each weapon, up to what the pockets hold.
  const revolverMax = tuning.revolverReserveMax;
  const shotgunMax = tuning.shotgunReserveMax;
  if (p.reserve.revolver >= revolverMax && p.reserve.shotgun >= shotgunMax) return false;
  p.reserve.revolver = Math.min(revolverMax, p.reserve.revolver + tuning.ammoPickupBullets);
  p.reserve.shotgun = Math.min(shotgunMax, p.reserve.shotgun + tuning.ammoPickupShells);
  return true;
}
