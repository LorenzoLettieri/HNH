// Turns raw input (input.ts) into what the game understands:
// - view angles, updated every rendered frame for the most responsive aim;
// - an InputCommand, built once per simulation tick.
import { consumeMouseDelta, isKeyDown, isPointerLocked } from './input';
import type { InputCommand } from './sim/command';

/** Client settings, mutable so the debug panel can change them. */
export const controlSettings = {
  /** Radians of rotation per pixel of mouse movement. */
  mouseSensitivity: 0.002,
};
const MAX_PITCH = Math.PI / 2 - 0.01; // just under 90°, so you can't flip over

/** Current view angles. Owned by the client, sampled into each command. */
export const view = { yaw: 0, pitch: 0 };

/** Call once per rendered frame: applies mouse movement to the view. */
export function updateLook(): void {
  const { dx, dy } = consumeMouseDelta();
  if (!isPointerLocked()) return;
  view.yaw -= dx * controlSettings.mouseSensitivity;
  view.pitch -= dy * controlSettings.mouseSensitivity;
  view.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, view.pitch));
}

/** Call once per simulation tick: snapshot of what the player wants right now. */
export function buildCommand(tick: number): InputCommand {
  let forward = 0;
  let strafe = 0;
  if (isKeyDown('KeyW')) forward += 1;
  if (isKeyDown('KeyS')) forward -= 1;
  if (isKeyDown('KeyD')) strafe += 1;
  if (isKeyDown('KeyA')) strafe -= 1;
  const jump = isKeyDown('Space');
  // Shift or C. Not Ctrl: Ctrl+W would close the browser tab!
  const crouch = isKeyDown('ShiftLeft') || isKeyDown('KeyC');
  const fire = isKeyDown('Mouse0');
  const reload = isKeyDown('KeyR');
  const respawn = isKeyDown('KeyK'); // K = "kill yourself" (debug)
  return { tick, forward, strafe, jump, crouch, fire, reload, respawn, yaw: view.yaw, pitch: view.pitch };
}
