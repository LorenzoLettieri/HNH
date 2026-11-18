import type { InputCommand } from './command';
import {
  AIR_ACCEL,
  AIR_SPEED_CAP,
  AUTO_BHOP,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_SPEED,
  MAX_GROUND_SPEED,
  STOP_SPEED,
} from './config';

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
  /** Standing on the ground (true) or airborne (false). */
  onGround: boolean;
  /** Was jump held during the previous tick? Used to detect a new press. */
  jumpHeld: boolean;
}

export function createPlayer(x = 0, y = 0, z = 0): PlayerState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, jumpHeld: false };
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

  // 2. Jump: only from the ground. With AUTO_BHOP off, it needs a fresh press.
  const jumpPressed = cmd.jump && (AUTO_BHOP || !p.jumpHeld);
  p.jumpHeld = cmd.jump;
  if (p.onGround && jumpPressed) {
    p.vy = JUMP_SPEED;
    p.onGround = false;
    // Note: we skip ground friction on the jump tick. If you jump the instant
    // you land, friction never touches you and you keep all your speed:
    // that's what makes bunny hopping work.
  }

  // 3. Ground: friction + ground acceleration. Air: no friction, air acceleration.
  if (p.onGround) {
    applyFriction(p, GROUND_FRICTION, dt);
    accelerate(p, wishX, wishZ, MAX_GROUND_SPEED, MAX_GROUND_SPEED, GROUND_ACCEL, dt);
  } else {
    accelerate(p, wishX, wishZ, MAX_GROUND_SPEED, AIR_SPEED_CAP, AIR_ACCEL, dt);
    p.vy -= GRAVITY * dt;
  }

  // 4. Integrate: velocity moves the position.
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;

  // 5. Ground check. Temporary: the ground is an infinite plane at y = 0.
  //    It'll be replaced by real collisions with the level.
  if (p.y <= 0) {
    p.y = 0;
    if (p.vy < 0) p.vy = 0;
    p.onGround = true;
  } else {
    p.onGround = false;
  }
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
 * (dot product), not the total speed. This quirk is what makes
 * air-strafing and bunny hopping possible.
 *
 * - wishSpeed: how hard we push (scales the acceleration).
 * - speedCap:  the max speed we may reach ALONG wishdir. On the ground it's
 *              the run speed; in the air it's tiny (AIR_SPEED_CAP).
 */
function accelerate(
  p: PlayerState,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  speedCap: number,
  accel: number,
  dt: number,
): void {
  if (wishX === 0 && wishZ === 0) return;
  // How fast are we already going in the wished direction?
  const currentSpeed = p.vx * wishX + p.vz * wishZ;
  const addSpeed = speedCap - currentSpeed;
  if (addSpeed <= 0) return;

  const accelSpeed = Math.min(accel * wishSpeed * dt, addSpeed);
  p.vx += accelSpeed * wishX;
  p.vz += accelSpeed * wishZ;
}
