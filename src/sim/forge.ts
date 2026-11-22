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
import type { WeaponId } from './weapon';
import type { World } from './world';

/** Why a gun can't be reinforced right now (null = it can). */
export type ForgeRefusal = 'far' | 'notOwned' | 'maxed' | 'noIron';

/**
 * Can this gun be reinforced? One function for both sides: the simulation
 * uses it to say yes or no, the panel to show why not ("non ce l'hai",
 * "rinforzata", "serve Ferro") before you even click.
 * The distance isn't checked here: the panel is open only near the Forge.
 */
export function forgeRefusal(p: PlayerState, weapon: WeaponId): ForgeRefusal | null {
  if (!p.owned[weapon]) return 'notOwned';
  if (p.forged[weapon] >= tuning.forgeMaxLevel) return 'maxed';
  if (p.damnedIron < tuning.forgeIronCost) return 'noIron';
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
  p.damnedIron -= tuning.forgeIronCost;
  p.forged[weapon]++;
  events.push({ type: 'forged', weapon, level: p.forged[weapon] });
}
