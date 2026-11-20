// Turns raw input (input.ts) into what the game understands:
// - view angles, updated every rendered frame for the most responsive aim;
// - an InputCommand, built once per simulation tick.
import type { PurchaseId } from './sim/shop';
import { consumeMouseDelta, isKeyDown, isPointerLocked, wasPressed } from './input';
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

export function buildCommand(tick: number): InputCommand {
  let forward = 0;
  let strafe = 0;
  if (isKeyDown('KeyW')) forward += 1;
  if (isKeyDown('KeyS')) forward -= 1;
  if (isKeyDown('KeyD')) strafe += 1;
  if (isKeyDown('KeyA')) strafe -= 1;
  // "held OR pressed since the last tick": a quick tap between two frames still counts.
  const jump = isKeyDown('Space') || wasPressed('Space');
  // Shift or C. Not Ctrl: Ctrl+W would close the browser tab!
  const crouch = isKeyDown('ShiftLeft') || isKeyDown('KeyC');
  const fire = isKeyDown('Mouse0') || wasPressed('Mouse0');
  // Right mouse button: the weapon's alternate fire (the carbine aims down the sights).
  const altFire = isKeyDown('Mouse2');
  const reload = isKeyDown('KeyR') || wasPressed('KeyR');
  // F: the boot.
  const kick = isKeyDown('KeyF') || wasPressed('KeyF');
  const respawn = isKeyDown('KeyK'); // K = "kill yourself" (debug)
  // Weapons: 1/2/3 pick a slot; Q or the wheel cycle. (wasPressed for all of
  // them: holding Q must not switch back and forth every tick.)
  let weaponSelect = 0;
  if (wasPressed('Digit1')) weaponSelect = 1;
  if (wasPressed('Digit2')) weaponSelect = 2;
  if (wasPressed('Digit3')) weaponSelect = 3;
  if (wasPressed('KeyQ') || wasPressed('WheelDown')) weaponSelect = -1;
  if (wasPressed('WheelUp')) weaponSelect = -2;
  const buy = pendingBuy;
  pendingBuy = null; // delivered: one click = one purchase attempt
  return {
    tick, forward, strafe, jump, crouch, fire, altFire, kick, reload, weaponSelect, respawn, buy, yaw: view.yaw, pitch: view.pitch,
  };
}
