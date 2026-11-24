// Turns raw input (input.ts) into what the game understands:
// - view angles, updated every rendered frame for the most responsive aim;
// - an InputCommand, built once per simulation tick.
import type { DrinkId } from './sim/drinks';
import type { PurchaseId } from './sim/shop';
import type { WeaponId } from './sim/weapon';
import { consumeMouseDelta, isPointerLocked } from './input';
import { actionActive, actionDown, actionPressed } from './keybinds';
import type { InputCommand } from './sim/command';

/** Client settings, mutable so the debug panel can change them. */
export const controlSettings = {
  /** Radians of rotation per pixel of mouse movement. */
  mouseSensitivity: 0.002,
  /** Multiplies the sensitivity: below 1 while zoomed in (set every frame by main.ts, see cameraFeel.lookScale). */
  lookScale: 1,
};
const MAX_PITCH = Math.PI / 2 - 0.01; // just under 90°, so you can't flip over

/** Current view angles. Owned by the client, sampled into each command. */
export const view = { yaw: 0, pitch: 0 };

/** Call once per rendered frame: applies mouse movement to the view. */
export function updateLook(): void {
  const { dx, dy } = consumeMouseDelta();
  if (!isPointerLocked()) return;
  const sens = controlSettings.mouseSensitivity * controlSettings.lookScale;
  view.yaw -= dx * sens;
  view.pitch -= dy * sens;
  view.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, view.pitch));
}

/** Call once per simulation tick: snapshot of what the player wants right now. */
/**
 * A purchase asked by the shop's panel (a click on "Compra"), waiting for
 * the next tick. The panel doesn't touch the game: it leaves a note here,
 * and the next InputCommand carries it to the simulation, like a key press.
 */
let pendingBuy: PurchaseId | null = null;
export function queueBuy(id: PurchaseId): void {
  pendingBuy = id;
}
/** Same for the saloon: the click on a drink becomes the next command's `drink`. */
let pendingDrink: DrinkId | null = null;
export function queueDrink(drink: DrinkId): void {
  pendingDrink = drink;
}

/** Same for the Forge: the click in its panel becomes the next command's `forge`. */
let pendingForge: WeaponId | null = null;
export function queueForge(weapon: WeaponId): void {
  pendingForge = weapon;
}

/** Same for the debug panel's "Respawn" button: the next command's `respawn`. */
/** E next to the devil's table (main.ts): the bet goes into the next command, like a purchase. */
let pendingWager = false;
export function queueWager(): void {
  pendingWager = true;
}

let pendingRespawn = false;
export function queueRespawn(): void {
  pendingRespawn = true;
}

export function buildCommand(tick: number): InputCommand {
  // Actions, not keys: which keys do what is in keybinds.ts (rebindable).
  let forward = 0;
  let strafe = 0;
  if (actionDown('forward')) forward += 1;
  if (actionDown('back')) forward -= 1;
  if (actionDown('right')) strafe += 1;
  if (actionDown('left')) strafe -= 1;
  // actionActive = "held OR pressed since the last tick": a quick tap between two frames still counts.
  const jump = actionActive('jump');
  // Default Shift or C. Not Ctrl: Ctrl+W would close the browser tab!
  const crouch = actionDown('crouch');
  const fire = actionActive('fire');
  // Alternate fire (default right button): the revolver fans, the carbine aims down the sights.
  const altFire = actionDown('altFire');
  const reload = actionActive('reload');
  const kick = actionActive('kick');
  // Weapons: a slot each, or cycle. (Pressed only: holding a key must not
  // switch back and forth every tick.) Every action is asked, even after a
  // "yes": asking also consumes the press (keybinds.ts).
  let weaponSelect = 0;
  const slots = [actionPressed('weapon1'), actionPressed('weapon2'), actionPressed('weapon3'), actionPressed('weapon4')];
  slots.forEach((pressed, i) => {
    if (pressed) weaponSelect = i + 1;
  });
  const next = actionPressed('nextWeapon');
  const prev = actionPressed('prevWeapon');
  if (next) weaponSelect = -1;
  if (prev) weaponSelect = -2;
  const buy = pendingBuy;
  pendingBuy = null; // delivered: one click = one purchase attempt
  const forge = pendingForge;
  pendingForge = null;
  const drink = pendingDrink;
  pendingDrink = null;
  const respawn = pendingRespawn;
  pendingRespawn = false;
  const wager = pendingWager;
  pendingWager = false;
  // Start the next wave now (default Q): the simulation ignores it while a wave is on (waves.ts).
  const skipBreak = actionPressed('skipBreak');
  return {
    tick, forward, strafe, jump, crouch, fire, altFire, kick, reload, weaponSelect, respawn, buy, forge, drink, wager, skipBreak,
    yaw: view.yaw, pitch: view.pitch,
  };
}
