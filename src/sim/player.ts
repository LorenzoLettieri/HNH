import type { InputCommand } from './command';
import { moveAndCollide } from './collision';
import type { World } from './world';
import {
  AIR_ACCEL,
  AIR_SPEED_CAP,
  AUTO_BHOP,
  COYOTE_TIME,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_BUFFER_TIME,
  JUMP_SPEED,
  KILL_Y,
  MAX_GROUND_SPEED,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  STOP_SPEED,
  secondsToTicks,
} from './config';

const COYOTE_TICKS = secondsToTicks(COYOTE_TIME);
const JUMP_BUFFER_TICKS = secondsToTicks(JUMP_BUFFER_TIME);

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
  /** Ticks left in which a jump is still allowed after leaving the ground. */
  coyoteTicks: number;
  /** Ticks left in which a recent jump press is still waiting to happen. */
  jumpBufferTicks: number;
}

export function createPlayer(x = 0, y = 0, z = 0): PlayerState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, jumpHeld: false,
    coyoteTicks: 0, jumpBufferTicks: 0 };
}

export function copyPlayer(from: PlayerState, to: PlayerState): void {
  Object.assign(to, from); // fine because the state is flat: only numbers
}

/** Horizontal speed (ignores vertical velocity), m/s. */
export function horizontalSpeed(p: PlayerState): number {
  return Math.hypot(p.vx, p.vz);
}

/** Advances the player by exactly one tick of `dt` seconds. */
export function stepPlayer(p: PlayerState, cmd: InputCommand, world: World, dt: number): void {
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

  // 2. Jump.
  // A "press" is a new press (or every tick while held, with AUTO_BHOP).
  // Pressing doesn't jump directly: it fills the buffer, which stays "armed"
  // for a few ticks. So a press slightly before landing isn't lost.
  const jumpPressed = cmd.jump && (AUTO_BHOP || !p.jumpHeld);
  p.jumpHeld = cmd.jump;
  if (jumpPressed) p.jumpBufferTicks = JUMP_BUFFER_TICKS;

  // On the ground the coyote timer is kept full; in the air it runs out.
  if (p.onGround) p.coyoteTicks = COYOTE_TICKS;

  const canJump = p.onGround || p.coyoteTicks > 0;
  if (p.jumpBufferTicks > 0 && canJump) {
    p.vy = JUMP_SPEED;
    p.onGround = false;
    p.jumpBufferTicks = 0;
    p.coyoteTicks = 0; // no double jump through coyote time
    // Note: we skip ground friction on the jump tick. If you jump the instant
    // you land, friction never touches you and you keep all your speed:
    // that's what makes bunny hopping work.
  }

  // Both timers count down by one each tick.
  if (p.jumpBufferTicks > 0) p.jumpBufferTicks--;
  if (!p.onGround && p.coyoteTicks > 0) p.coyoteTicks--;

  // 3. Ground: friction + ground acceleration. Air: no friction, air acceleration.
  if (p.onGround) {
    applyFriction(p, GROUND_FRICTION, dt);
    accelerate(p, wishX, wishZ, MAX_GROUND_SPEED, MAX_GROUND_SPEED, GROUND_ACCEL, dt);
  } else {
    accelerate(p, wishX, wishZ, MAX_GROUND_SPEED, AIR_SPEED_CAP, AIR_ACCEL, dt);
  }

  // Gravity applies ALWAYS, even on the ground: every tick it pushes us a tiny
  // bit into the floor, the collision pushes us back up and says "landed".
  // That's how we know we're still standing on something (and not on air,
  // e.g. after walking off a ledge).
  p.vy -= GRAVITY * dt;

  // 4. Move, colliding with the level.
  const { landed } = moveAndCollide(p, PLAYER_RADIUS, PLAYER_HEIGHT, world.boxes, dt);
  p.onGround = landed;

  // 5. Fell off the world (or asked to): back to the spawn point.
  if (p.y < KILL_Y || cmd.respawn) respawn(p, world);
}

export function respawn(p: PlayerState, world: World): void {
  p.x = world.spawn.x;
  p.y = world.spawn.y;
  p.z = world.spawn.z;
  p.vx = p.vy = p.vz = 0;
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
