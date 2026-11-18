import type { InputCommand } from './command';
import { findWall, moveAndCollide, overlapsAny } from './collision';
import type { World } from './world';
import { ventUnder } from './props';
import { secondsToTicks, tuning } from './config';

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
  /** Crouched: shorter collision box, lower camera. Also true while sliding. */
  crouched: boolean;
  /** Sliding: low friction, keeps momentum. */
  sliding: boolean;
  /** Ticks left before a new slide can give a speed boost again. */
  slideCooldownTicks: number;
  /** Wall jumps still available before touching the ground. */
  wallJumpsLeft: number;
  /** Ticks left before another wall jump is allowed. */
  wallJumpCooldownTicks: number;
}

export function createPlayer(x = 0, y = 0, z = 0): PlayerState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    onGround: true,
    jumpHeld: false,
    coyoteTicks: 0,
    jumpBufferTicks: 0,
    crouched: false,
    sliding: false,
    slideCooldownTicks: 0,
    wallJumpsLeft: tuning.wallJumpsMax,
    wallJumpCooldownTicks: 0,
  };
}

export function copyPlayer(from: PlayerState, to: PlayerState): void {
  Object.assign(to, from); // fine because the state is flat: only numbers
}

/** Height of the player's collision box right now (shorter when crouched). */
export function currentHeight(p: PlayerState): number {
  return p.crouched ? tuning.crouchHeight : tuning.playerHeight;
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

  // 2. Crouch and slide (see the function for the rules).
  updateCrouchAndSlide(p, cmd.crouch, world);

  // 3. Steam vents: standing on one launches you (keeping your horizontal speed).
  if (p.onGround) {
    const vent = ventUnder(world.props, p.x, p.y, p.z);
    if (vent) {
      p.vy = vent.up;
      p.vx += vent.pushX ?? 0;
      p.vz += vent.pushZ ?? 0;
      p.onGround = false;
      p.sliding = false;
      p.coyoteTicks = 0; // a jump press this tick must not override the launch
    }
  }

  // 4. Jump.
  // A "press" is a new press (or every tick while held, with tuning.autoBhop).
  // Pressing doesn't jump directly: it fills the buffer, which stays "armed"
  // for a few ticks. So a press slightly before landing isn't lost.
  const jumpPressed = cmd.jump && (tuning.autoBhop || !p.jumpHeld);
  p.jumpHeld = cmd.jump;
  if (jumpPressed) p.jumpBufferTicks = secondsToTicks(tuning.jumpBufferTime);

  // On the ground the coyote timer is kept full; in the air it runs out.
  if (p.onGround) p.coyoteTicks = secondsToTicks(tuning.coyoteTime);

  const canJump = p.onGround || p.coyoteTicks > 0;
  if (p.jumpBufferTicks > 0 && canJump) {
    p.vy = tuning.jumpSpeed;
    p.onGround = false;
    p.sliding = false; // slide-jump: the slide ends, its speed stays with you
    p.jumpBufferTicks = 0;
    p.coyoteTicks = 0; // no double jump through coyote time
    // Note: we skip ground friction on the jump tick. If you jump the instant
    // you land, friction never touches you and you keep all your speed:
    // that's what makes bunny hopping (and slide-hopping) work.
  } else if (
    p.jumpBufferTicks > 0 &&
    !p.onGround &&
    p.wallJumpsLeft > 0 &&
    p.wallJumpCooldownTicks === 0
  ) {
    tryWallJump(p, world);
  }

  // Both timers count down by one each tick.
  if (p.jumpBufferTicks > 0) p.jumpBufferTicks--;
  if (!p.onGround && p.coyoteTicks > 0) p.coyoteTicks--;
  if (p.slideCooldownTicks > 0) p.slideCooldownTicks--;
  if (p.wallJumpCooldownTicks > 0) p.wallJumpCooldownTicks--;

  // 5. Movement, depending on the state we're in.
  if (p.sliding) {
    // Sliding: very little friction, and only a bit of steering (like in the air).
    applyFriction(p, tuning.slideFriction, dt);
    accelerate(p, wishX, wishZ, tuning.maxGroundSpeed, tuning.airSpeedCap, tuning.slideSteer, dt);
  } else if (p.onGround) {
    // On foot (standing or crouch-walking): friction + ground acceleration.
    const maxSpeed = p.crouched ? tuning.crouchSpeed : tuning.maxGroundSpeed;
    applyFriction(p, tuning.groundFriction, dt);
    accelerate(p, wishX, wishZ, maxSpeed, maxSpeed, tuning.groundAccel, dt);
  } else {
    // In the air: no friction, air acceleration (air-strafing).
    accelerate(p, wishX, wishZ, tuning.maxGroundSpeed, tuning.airSpeedCap, tuning.airAccel, dt);
  }

  // Gravity applies ALWAYS, even on the ground: every tick it pushes us a tiny
  // bit into the floor, the collision pushes us back up and says "landed".
  // That's how we know we're still standing on something (and not on air,
  // e.g. after walking off a ledge).
  p.vy -= tuning.gravity * dt;

  // 6. Move, colliding with the level.
  const { landed } = moveAndCollide(p, tuning.playerRadius, currentHeight(p), world.boxes, dt);
  p.onGround = landed;
  if (landed) p.wallJumpsLeft = tuning.wallJumpsMax; // touching ground recharges wall jumps
  if (!landed) p.sliding = false; // slid off a ledge: now we're just falling

  // 7. Fell off the world (or asked to): back to the spawn point.
  if (p.y < tuning.killY || cmd.respawn) respawn(p, world);
}

/**
 * The crouch/slide rules, as a small state machine:
 * - crouch held, on the ground, fast enough → SLIDE (with a boost, if off cooldown);
 * - sliding and too slow                    → CROUCH (crouch-walking);
 * - crouch released                         → STAND UP, but only if there's room
 *                                             above (you might be under a beam).
 */
function updateCrouchAndSlide(p: PlayerState, crouchHeld: boolean, world: World): void {
  if (crouchHeld) {
    p.crouched = true;
    const speed = horizontalSpeed(p);
    if (!p.sliding && p.onGround && speed >= tuning.slideStartSpeed) {
      p.sliding = true;
      if (p.slideCooldownTicks === 0 && speed < tuning.slideBoostMaxSpeed) {
        // Boost along the current direction, without exceeding the cap.
        const boosted = Math.min(speed + tuning.slideBoost, tuning.slideBoostMaxSpeed);
        p.vx *= boosted / speed;
        p.vz *= boosted / speed;
        p.slideCooldownTicks = secondsToTicks(tuning.slideBoostCooldown);
      }
    }
    if (p.sliding && speed < tuning.slideStopSpeed) p.sliding = false;
  } else {
    p.sliding = false;
    // Stand up only if a full-height body fits here.
    if (p.crouched && !overlapsAny(p.x, p.y, p.z, tuning.playerRadius, tuning.playerHeight, world.boxes)) {
      p.crouched = false;
    }
  }
}

/** Jumps off a nearby wall: up, and pushed away from it. Keeps the speed along the wall. */
function tryWallJump(p: PlayerState, world: World): void {
  const wall = findWall(p, tuning.playerRadius, currentHeight(p), tuning.wallJumpReach, world.boxes);
  if (!wall) return;

  // Remove the part of our velocity going INTO the wall (dot product with the
  // normal, again!), then add a push away from it.
  const into = p.vx * wall.nx + p.vz * wall.nz;
  if (into < 0) {
    p.vx -= into * wall.nx;
    p.vz -= into * wall.nz;
  }
  p.vx += wall.nx * tuning.wallJumpPush;
  p.vz += wall.nz * tuning.wallJumpPush;
  p.vy = tuning.wallJumpUp;
  p.wallJumpsLeft--;
  p.wallJumpCooldownTicks = secondsToTicks(tuning.wallJumpCooldown);
  p.jumpBufferTicks = 0;
}

export function respawn(p: PlayerState, world: World): void {
  p.x = world.spawn.x;
  p.y = world.spawn.y;
  p.z = world.spawn.z;
  p.vx = p.vy = p.vz = 0;
  p.crouched = false;
  p.sliding = false;
}

/** Quake's friction: removes a slice of speed every tick, keeping the direction. */
function applyFriction(p: PlayerState, friction: number, dt: number): void {
  const speed = horizontalSpeed(p);
  if (speed < 0.001) {
    p.vx = 0;
    p.vz = 0;
    return;
  }
  const control = Math.max(speed, tuning.stopSpeed);
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
 *              the run speed; in the air it's tiny (tuning.airSpeedCap).
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
