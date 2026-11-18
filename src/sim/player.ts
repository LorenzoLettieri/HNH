import type { InputCommand } from './command';
import { MOVE_SPEED } from './config';

// Pure data: no Three.js, no DOM. Can be copied, compared, sent over the network.
export interface PlayerState {
  /** Position of the feet, meters. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export function createPlayer(x = 0, y = 0, z = 0): PlayerState {
  return { x, y, z, yaw: 0, pitch: 0 };
}

export function copyPlayer(from: PlayerState, to: PlayerState): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.yaw = from.yaw;
  to.pitch = from.pitch;
}

/** Advances the player by exactly one tick of `dt` seconds. */
export function stepPlayer(p: PlayerState, cmd: InputCommand, dt: number): void {
  p.yaw = cmd.yaw;
  p.pitch = cmd.pitch;

  // Forward/right on the ground plane, from yaw only (looking up doesn't make you fly).
  const fwdX = -Math.sin(p.yaw);
  const fwdZ = -Math.cos(p.yaw);
  const rightX = Math.cos(p.yaw);
  const rightZ = -Math.sin(p.yaw);

  let moveX = fwdX * cmd.forward + rightX * cmd.strafe;
  let moveZ = fwdZ * cmd.forward + rightZ * cmd.strafe;

  // Normalize, otherwise diagonals would be ~41% faster (√2).
  const len = Math.hypot(moveX, moveZ);
  if (len > 0) {
    moveX /= len;
    moveZ /= len;
  }

  p.x += moveX * MOVE_SPEED * dt;
  p.z += moveZ * MOVE_SPEED * dt;
}
