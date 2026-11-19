import type { ShopItemId } from './shop';
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
  /** Kick button held (melee). */
  kick: boolean;
  /** Reload button held. */
  reload: boolean;
  /**
   * Weapon change asked this tick: 0 = none, 1..N = that slot (1 = revolver,
   * 2 = shotgun), -1 = next weapon, -2 = previous (mouse wheel, Q).
   */
  weaponSelect: number;
  /** Go back to the spawn point (debug/testing). */
  respawn: boolean;
  /**
   * Buy this item at the shop within reach (null = nothing). Clicking in the
   * shop's panel doesn't change the game directly: it becomes this field,
   * and the simulation decides (money, distance...). One day: the server.
   */
  buy: ShopItemId | null;
  /** View angles (radians) at the time the command was built. */
  yaw: number;
  pitch: number;
}
