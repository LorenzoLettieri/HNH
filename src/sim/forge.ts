// The Forge (docs/DESIGN.md §6d): bring Damned Iron, pick a gun, and the gun
// comes out reinforced (forge level 1: more damage, see forgeMultiplier in
// weapon.ts; one day also a new look).
//
// Same pattern as the shop (shop.ts): the panel on screen only ASKS (the
// command's `forge` field), the simulation checks everything and answers
// with an event. The Forge is a ShopSpawn of kind 'forge' in the level, so
// "is it within reach" is the shop's own shopInReach.
import type { InputCommand } from './command';
import { tuning } from './config';
import type { SimEvent } from './events';
import type { PlayerState } from './player';
import { shopInReach } from './shop';
import { magazineSize, type WeaponId } from './weapon';
import type { World } from './world';

/** Why a gun can't be reinforced right now (null = it can). */
export type ForgeRefusal = 'far' | 'notOwned' | 'maxed' | 'noIron' | 'notForgeable';

/**
 * The guns the Forge knows how to reinforce: all of them, now (the dynamite
 * launcher's holy-water sticks: holyFire.ts). A type of its own, so a gun
 * left out of the Forge one day is a deliberate choice, and the Forge's
 * texts (forgeMenu.ts) must exist for exactly these.
 */
export type ForgeableWeapon = WeaponId;
export const FORGEABLE: readonly ForgeableWeapon[] = ['revolver', 'shotgun', 'rifle', 'dynamite'];

function isForgeable(w: WeaponId): w is ForgeableWeapon {
  return (FORGEABLE as readonly WeaponId[]).includes(w);
}

/**
 * How much iron the NEXT reinforcement costs: one more for every one already
 * done, on any gun (1, 2, 3, 4 with the defaults). Counted from the forge
 * levels themselves, so there's no extra counter to keep in sync (and to
 * save, one day, on the server): the state already knows it.
 */
export function forgeCost(p: PlayerState): number {
  let done = 0;
  for (const w of FORGEABLE) done += p.forged[w];
  return tuning.forgeIronCost + tuning.forgeIronCostStep * done;
}

/**
 * Can this gun be reinforced? One function for both sides: the simulation
 * uses it to say yes or no, the panel to show why not ("non ce l'hai",
 * "rinforzata", "serve Ferro") before you even click.
 * The distance isn't checked here: the panel is open only near the Forge.
 */
export function forgeRefusal(p: PlayerState, weapon: WeaponId): ForgeRefusal | null {
  if (!isForgeable(weapon)) return 'notForgeable';
  if (!p.owned[weapon]) return 'notOwned';
  if (p.forged[weapon] >= tuning.forgeMaxLevel) return 'maxed';
  if (p.damnedIron < forgeCost(p)) return 'noIron';
  return null;
}

/** One tick of forging: if the command asks to reinforce a gun, check and do it. */
export function stepForge(p: PlayerState, cmd: InputCommand, world: World, events: SimEvent[]): void {
  const weapon = cmd.forge;
  if (!weapon) return;
  // A client could claim to be at the Forge from the other side of the map:
  // the distance is checked here, where one day the server will check it.
  const refusal = shopInReach(p, world)?.kind === 'forge' ? forgeRefusal(p, weapon) : 'far';
  if (refusal) return void events.push({ type: 'forgeFailed', weapon, reason: refusal });
  p.damnedIron -= forgeCost(p); // before forged++: the price of THIS one
  p.forged[weapon]++;
  // It comes out of the fire loaded (akimbo: both cylinders full).
  p.loaded[weapon] = magazineSize(p, weapon);
  events.push({ type: 'forged', weapon, level: p.forged[weapon] });
}
