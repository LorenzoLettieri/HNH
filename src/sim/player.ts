import type { InputCommand } from './command';
import { GROUND_ACCEL, GROUND_FRICTION, MAX_GROUND_SPEED, STOP_SPEED } from './config';

// Pure data: no Three.js, no DOM. Can be copied, compared, sent over the network.
export interface PlayerState {
  /** Position of the feet, meters. */
  x: number;
  y: number;
  z: number;
  /** Velocity, meters per second. */
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
}

export function createPlayer(x = 0, y = 0, z = 0): PlayerState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 };
}

export function copyPlayer(from: PlayerState, to: PlayerState): void {
  Object.assign(to, from); // fine because the state is flat: only numbers
}

/** Horizontal speed (ignores vertical velocity), m/s. */
export function horizontalSpeed(p: PlayerState): number {
  return Math.hypot(p.vx, p.vz);
}

/** Advances the player by exactly one tick of `dt` seconds. */
export function stepPlayer(p: PlayerState, cmd: InputCommand, dt: number): void {
  p.yaw = cmd.yaw;
  p.pitch = cmd.pitch;

  // 1. Where does the player WANT to go? (unit vector on the ground plane, or zero)
  const fwdX = -Math.sin(p.yaw);
  const fwdZ = -Math.cos(p.yaw);
  const rightX = Math.cos(p.yaw);
  const rightZ = -Math.sin(p.yaw);

  let wishX = fwdX * cmd.forward + rightX * cmd.strafe;
  let wishZ = fwdZ * cmd.forward + rightZ * cmd.strafe;
  const len = Math.hypot(wishX, wishZ);
  if (len > 0) {
    wishX /= len;
    wishZ /= len;
  }

  // 2. Friction slows us down, 3. acceleration pushes us toward wishdir.
  applyFriction(p, GROUND_FRICTION, dt);
  accelerate(p, wishX, wishZ, MAX_GROUND_SPEED, GROUND_ACCEL, dt);

  // 4. Integrate: velocity moves the position.
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
}

/** Quake's friction: removes a slice of speed every tick, keeping the direction. */
function applyFriction(p: PlayerState, friction: number, dt: number): void {
  const speed = horizontalSpeed(p);
  if (speed < 0.001) {
    p.vx = 0;
    p.vz = 0;
    return;
  }
  const control = Math.max(speed, STOP_SPEED);
  const drop = control * friction * dt;
  const newSpeed = Math.max(speed - drop, 0);
  const scale = newSpeed / speed;
  p.vx *= scale;
  p.vz *= scale;
}

/**
 * Quake's acceleration. Key detail: it limits the speed ALONG wishdir
 * (dot product), not the total speed. This quirk is what will later make
 * air-strafing and bunny hopping possible.
 */
function accelerate(
  p: PlayerState,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  accel: number,
  dt: number,
): void {
  // How fast are we already going in the wished direction?
  const currentSpeed = p.vx * wishX + p.vz * wishZ;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;

  const accelSpeed = Math.min(accel * wishSpeed * dt, addSpeed);
  p.vx += accelSpeed * wishX;
  p.vz += accelSpeed * wishZ;
}
