import type { DrinkId } from './drinks';
import type { PurchaseId } from './shop';
import type { WeaponId } from './weapon';
// What the player wants to do during ONE tick. The simulation only ever sees
// this, never the keyboard or mouse directly. Later, the same object will be
// sent over the network to the server.
export interface InputCommand {
  /** Which tick this command is for. */
  tick: number;
  /** -1 = backward, 0 = none, 1 = forward. */
  forward: number;
  /** -1 = left, 0 = none, 1 = right. */
  strafe: number;
  /** Jump button held down during this tick. */
  jump: boolean;
  /** Crouch button held (crouch, or slide if running fast enough). */
  crouch: boolean;
  /** Fire button held (left mouse). */
  fire: boolean;
  /**
   * Alternate fire held (right mouse button): what it does depends on the
   * weapon. The carbine aims down the sights; the revolver FANS the whole
   * cylinder in a burst (a press starts it); the lasso throws its grappling
   * hook (held = it reels you in); the shotgun nothing, for now.
   */
  altFire: boolean;
  /** Kick button held (melee). */
  kick: boolean;
  /** Reload button held. */
  reload: boolean;
  /**
   * Weapon change asked this tick: 0 = none, 1..N = that slot (1 = revolver,
   * 2 = shotgun, 3 = carbine, 4 = dynamite launcher, 5 = the melee weapon you carry:
   * MELEE_KEY in weapon.ts), -1 = next weapon, -2 = previous (mouse wheel).
   */
  weaponSelect: number;
  /** Go back to the spawn point (debug/testing). */
  respawn: boolean;
  /**
   * Buy this item at the shop within reach (null = nothing). Clicking in the
   * shop's panel doesn't change the game directly: it becomes this field,
   * and the simulation decides (money, distance...). One day: the server.
   * A weapon or an upgrade card (shop.ts, PurchaseId).
   */
  buy: PurchaseId | null;
  /** Reinforce this gun at the Forge within reach (null = nothing). Same idea as `buy` (forge.ts). */
  forge: WeaponId | null;
  /** Order this drink at the saloon's counter within reach (null = nothing). Same idea as `buy` (drinks.ts). */
  drink: DrinkId | null;
  /** Take the devil's wager at the table within reach (wager.ts): E next to the table. */
  wager: boolean;
  /**
   * Start the next wave now, without waiting for the end of the break
   * (waves.ts; default key Q, action 'skipBreak' in keybinds.ts). Ignored while a wave is on. In multiplayer it will become a
   * vote, but the field stays the same: "this player is ready".
   */
  skipBreak: boolean;
  /** View angles (radians) at the time the command was built. */
  yaw: number;
  pitch: number;
}
