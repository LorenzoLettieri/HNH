// Shops (docs/DESIGN.md §5, "Economia"): where the vildenaro gets spent.
// The simulation side is only two things:
// - "is the player close enough to a vendor to trade?" (shopInReach);
// - what each shop sells and for how much (shopCatalog).
// They live here, not in the UI, because one day the SERVER will have to say
// yes or no to a purchase: a client could claim to be next to the vendor
// from the other side of the map. Same rule as everything in src/sim: no DOM.
import type { InputCommand } from './command';
import { tuning } from './config';
import type { SimEvent } from './events';
import type { PlayerState } from './player';
import { switchWeapon, type WeaponId } from './weapon';
import type { ShopSpawn, World } from './world';

/** Everything for sale. For now only weapons, so an item id IS a weapon id. */
export type ShopItemId = Exclude<WeaponId, 'revolver'>;

export interface ShopItem {
  id: ShopItemId;
  /** Price in vildenaro (read from tuning when asked: the debug panel can change it). */
  price: number;
}

/** What a kind of shop sells. One list per kind: the armory sells weapons. */
export function shopCatalog(kind: ShopSpawn['kind']): ShopItem[] {
  switch (kind) {
    case 'weapons':
      return [
        { id: 'shotgun', price: tuning.shotgunPrice },
        { id: 'rifle', price: tuning.riflePrice },
      ];
  }
}

/**
 * The shop whose vendor is within reach, or null. "Within reach" = close
 * horizontally (a cylinder around the vendor, like the pickups) and on the
 * same floor: standing on the roof above him doesn't count.
 */
export function shopInReach(p: PlayerState, world: World): ShopSpawn | null {
  for (const shop of world.shops ?? []) {
    const near = Math.hypot(p.x - shop.x, p.z - shop.z) < tuning.shopReach;
    const sameFloor = Math.abs(p.y - shop.y) < tuning.shopReachHeight;
    if (near && sameFloor) return shop;
  }
  return null;
}

/** Do you already have it? (For now everything for sale is a weapon.) */
export function ownsItem(p: PlayerState, id: ShopItemId): boolean {
  return p.owned[id];
}

/**
 * One tick of shopping: if the command asks to buy something, check
 * everything (a vendor within reach that sells it, not already yours, enough
 * vildenaro), then take the money and hand it over. Either way an event says
 * how it went: the UI only finds out from the events, it never guesses.
 */
export function stepShop(p: PlayerState, cmd: InputCommand, world: World, events: SimEvent[]): void {
  if (!cmd.buy) return;
  const id = cmd.buy;
  const shop = shopInReach(p, world);
  const item = shop ? shopCatalog(shop.kind).find((i) => i.id === id) : undefined;
  if (!item) return void events.push({ type: 'purchaseFailed', item: id, reason: 'far' });
  if (ownsItem(p, id)) return void events.push({ type: 'purchaseFailed', item: id, reason: 'owned' });
  if (p.money < item.price) return void events.push({ type: 'purchaseFailed', item: id, reason: 'money' });

  p.money -= item.price;
  // A new weapon comes loaded, with the starting spare rounds, and goes
  // straight to your hands (you bought it to use it, right now).
  p.owned[id] = true;
  if (id === 'shotgun') {
    p.loaded.shotgun = tuning.shotgunAmmo;
    p.reserve.shells = Math.max(p.reserve.shells, tuning.shotgunReserveStart);
  }
  if (id === 'rifle') {
    // The carbine shoots the revolver's bullets: a box of them comes with it.
    p.loaded.rifle = tuning.rifleAmmo;
    p.reserve.bullets = Math.min(tuning.revolverReserveMax, p.reserve.bullets + tuning.rifleBuyBullets);
  }
  switchWeapon(p, id, events);
  events.push({ type: 'purchase', item: id, price: item.price });
}
