// Shops (docs/DESIGN.md §5, "Economia"): where the vildenaro gets spent.
// The simulation side is only two things:
// - "is the player close enough to a vendor to trade?" (shopInReach);
// - what each shop sells and for how much (shopCatalog).
// They live here, not in the UI, because one day the SERVER will have to say
// yes or no to a purchase: a client could claim to be next to the vendor
// from the other side of the map. Same rule as everything in src/sim: no DOM.
import { tuning } from './config';
import type { PlayerState } from './player';
import type { ShopSpawn, World } from './world';

export type ShopItemId = 'shotgun';

export interface ShopItem {
  id: ShopItemId;
  /** Price in vildenaro (read from tuning when asked: the debug panel can change it). */
  price: number;
}

/** What a kind of shop sells. One list per kind: the armory sells weapons. */
export function shopCatalog(kind: ShopSpawn['kind']): ShopItem[] {
  switch (kind) {
    case 'weapons':
      return [{ id: 'shotgun', price: tuning.shotgunPrice }];
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
