import type { InputCommand } from './command';
import { findWall, moveAndCollide, overlapsAny } from './collision';
import type { World } from './world';
import { ventUnder } from './props';
import { secondsToTicks, tuning } from './config';
import type { AmmoType, WeaponId } from './weapon';
import type { SimEvent } from './events';
import { noCards, type CardId } from './upgrades';

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
  /** Ticks spent on the ground since the last landing (big number = "long ago"). */
  groundTicks: number;
  /** Ticks spent in the air since leaving the ground (0 on the ground). */
  airTicks: number;

  // --- Weapons (see weapon.ts) ---
  /** The weapon in your hands. */
  weapon: WeaponId;
  /** Ticks left before the weapon you just switched to is ready (0 = ready). */
  switchTicks: number;
  /**
   * Rounds IN each weapon (revolver's cylinder, shotgun's barrels, carbine's
   * magazine tube). A Record keyed by WeaponId (plain data, serializable):
   * adding a weapon = adding a key.
   */
  loaded: Record<WeaponId, number>;
  /**
   * Spare rounds in your pockets, per AMMO TYPE (the revolver and the
   * carbine share the bullets): the reload moves them into the gun.
   */
  reserve: Record<AmmoType, number>;
  /**
   * Aiming down the sights (the carbine): ticks spent raising the gun to the
   * eye, from 0 (from the hip) up to rifleAdsTime. See adsAmount in weapon.ts.
   */
  adsTicks: number;
  /**
   * Which weapons you own. You start with the revolver; the others are
   * bought at the armory (shop.ts). Slots you don't own are skipped.
   */
  owned: Record<WeaponId, boolean>;
  /**
   * The vildenaro in your pocket: the game's money (coins dropped by the
   * enemies, spent in the shops). On the player, not in the game's stats:
   * in multiplayer every player has their own wallet.
   */
  money: number;
  /**
   * Upgrade cards bought for each weapon (upgrades.ts), in the order you
   * bought them: how many = the weapon's level. Lost when you die.
   */
  cards: Record<WeaponId, CardId[]>;
  /**
   * Seed of the cards drawn at the armory (upgrades.ts): rolled once per
   * game, so the counter shows the same cards until you buy one.
   */
  cardSeed: number;
  /** Ticks left before the next shot is allowed. */
  fireCooldownTicks: number;
  /** Ticks left in which a recent click is still waiting to fire. */
  fireBufferTicks: number;
  /** Was fire held during the previous tick? (semi-auto: one click = one shot) */
  fireHeld: boolean;
  /** Ticks left until the reload finishes (0 = not reloading). */
  reloadTicks: number;
  /** Was alternate fire held during the previous tick? (fanning starts on a new press) */
  altFireHeld: boolean;
  /** The buffered click was a right click: when the gun is ready, start fanning instead of one shot. */
  fanQueued: boolean;
  /** Shots still to fire in the fanning burst (0 = not fanning). See weapon.ts. */
  fanShotsLeft: number;
  /** Card "Ricarica in scivolata": ticks of sliding still needed for the next round (weapon.ts). */
  slideReloadTicks: number;
  /**
   * You wall-jumped and haven't fired or landed since: the card "Colpo da
   * cavaliere" makes that shot a critical hit (weapon.ts). Set without the
   * card too: it's just a fact about the jump, the weapon decides what it's worth.
   */
  wallJumpShot: boolean;
  /**
   * Card "Volo di piombo": shells spent on shotgun jumps since you left the
   * ground. A kill before landing gives them back (refundLeadFlight in weapon.ts).
   */
  leadFlightShells: number;

  // --- Kick (see kick.ts) ---
  /** Ticks since the kick started (0 = not kicking). The foot lands at kickWindup. */
  kickTicks: number;
  /** Ticks left before the next kick is allowed. */
  kickCooldownTicks: number;
  /** Was kick held during the previous tick? (one press = one kick) */
  kickHeld: boolean;

  // --- Health ---
  /** No regeneration: health comes back only from pickups (future). */
  health: number;
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
    groundTicks: 999,
    airTicks: 0,
    weapon: 'revolver',
    switchTicks: 0,
    loaded: fullWeapons(),
    reserve: startingReserve(),
    adsTicks: 0,
    owned: startingWeapons(),
    money: 0,
    cards: noCards(),
    cardSeed: 0,
    fireCooldownTicks: 0,
    fireBufferTicks: 0,
    fireHeld: false,
    reloadTicks: 0,
    altFireHeld: false,
    fanQueued: false,
    fanShotsLeft: 0,
    slideReloadTicks: 0,
    wallJumpShot: false,
    leadFlightShells: 0,
    kickTicks: 0,
    kickCooldownTicks: 0,
    kickHeld: false,
    health: tuning.playerMaxHealth,
  };
}

export function copyPlayer(from: PlayerState, to: PlayerState): void {
  Object.assign(to, from); // copies numbers and booleans...
  // ...but `reserve` is an object: Object.assign would copy the REFERENCE, and
  // both players would share the same pockets. Copy it by value (a shallow
  // copy is enough: inside it there are only numbers).
  to.reserve = { ...from.reserve };
  to.loaded = { ...from.loaded };
  to.owned = { ...from.owned }; // same story
  // Arrays inside an object: one level deeper (each array copied too).
  to.cards = { revolver: [...from.cards.revolver], shotgun: [...from.cards.shotgun], rifle: [...from.cards.rifle] };
}

/** Height of the player's collision box right now (shorter when crouched). */
export function currentHeight(p: PlayerState): number {
  return p.crouched ? tuning.crouchHeight : tuning.playerHeight;
}

/** Height of the eyes above the feet (lower when crouched). Bullets start here. */
export function currentEyeHeight(p: PlayerState): number {
  return p.crouched ? tuning.crouchEyeHeight : tuning.eyeHeight;
}

/** Horizontal speed (ignores vertical velocity), m/s. */
export function horizontalSpeed(p: PlayerState): number {
  return Math.hypot(p.vx, p.vz);
}

/** Advances the player by exactly one tick of `dt` seconds. */
export function stepPlayer(p: PlayerState, cmd: InputCommand, world: World, dt: number, events: SimEvent[]): void {
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
      events.push({ type: 'ventLaunch' });
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
    // A "hop": jumping again shortly after landing. Reward it with a bit of speed.
    const isHop = p.onGround && p.groundTicks <= secondsToTicks(tuning.bhopGraceTime);
    if (isHop) addSpeedAlongVelocity(p, tuning.bhopBoost);
    events.push({ type: 'jump', hop: isHop, slide: p.sliding });
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
    if (tryWallJump(p, world)) {
      events.push({ type: 'wallJump', left: p.wallJumpsLeft });
      p.wallJumpShot = true;
    }
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
    // Right after landing there's a grace window with no friction: a hop
    // within it keeps all your speed (forgiving bunny hopping).
    const maxSpeed = p.crouched ? tuning.crouchSpeed : tuning.maxGroundSpeed;
    if (p.groundTicks >= secondsToTicks(tuning.bhopGraceTime)) {
      applyFriction(p, tuning.groundFriction, dt);
    }
    accelerate(p, wishX, wishZ, maxSpeed, maxSpeed, tuning.groundAccel, dt);
  } else {
    // In the air: Quake air acceleration (air-strafing) + air control.
    // (No extra "air brake" needed: Quake's acceleration already slows you
    // down hard when you hold the opposite direction.)
    accelerate(p, wishX, wishZ, tuning.maxGroundSpeed, tuning.airSpeedCap, tuning.airAccel, dt);
    airSteer(p, wishX, wishZ, dt);
  }

  // Gravity applies ALWAYS, even on the ground: every tick it pushes us a tiny
  // bit into the floor, the collision pushes us back up and says "landed".
  // That's how we know we're still standing on something (and not on air,
  // e.g. after walking off a ledge).
  p.vy -= tuning.gravity * dt;

  // 6. Move, colliding with the level.
  const wasOnGround = p.onGround;
  const { landed } = moveAndCollide(p, tuning.playerRadius, currentHeight(p), world.boxes, dt);
  p.onGround = landed;
  // Count ticks on the ground: 0 on the landing tick, then 1, 2, ...
  p.groundTicks = landed ? (wasOnGround ? p.groundTicks + 1 : 0) : 0;
  // Landing after a flight: say how long it was (the style rewards long ones).
  if (landed && !wasOnGround && p.airTicks > 0) events.push({ type: 'land', airTicks: p.airTicks });
  p.airTicks = landed ? 0 : p.airTicks + 1;
  if (landed) {
    p.wallJumpsLeft = tuning.wallJumpsMax; // touching ground recharges wall jumps
    p.wallJumpShot = false; // ...and the wall jump's shot was missed
    p.leadFlightShells = 0; // ...and the shotgun jump's shells are spent for good
  }
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
 * In the AIR nothing changes: you keep the stance you jumped with until you
 * land. Crouching keeps the feet where they are and lowers the head, so
 * toggling it mid-air (crouch going up, stand going down) moved the camera
 * against gravity: the view barely dipped and you seemed to glide.
 * Holding crouch before landing still works: it applies on the first tick
 * on the ground (land → slide).
 */
function updateCrouchAndSlide(p: PlayerState, crouchHeld: boolean, world: World): void {
  if (!p.onGround) return;
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

/**
 * Apex-style wall jump: a strong kick UP, a small push away from the wall,
 * and a speed boost ALONG the wall in the direction you're looking.
 * Run along a wall, jump, and you're launched forward and up.
 */
function tryWallJump(p: PlayerState, world: World): boolean {
  const wall = findWall(p, tuning.playerRadius, currentHeight(p), tuning.wallJumpReach, world.boxes);
  if (!wall) return false;

  // 1. Remove the part of our velocity going INTO the wall (dot product with
  //    the normal): we keep only the motion parallel to the wall.
  const into = p.vx * wall.nx + p.vz * wall.nz;
  if (into < 0) {
    p.vx -= into * wall.nx;
    p.vz -= into * wall.nz;
  }

  // 2. Boost along the wall, toward where we're looking. "Along the wall" =
  //    the look direction with its into-the-wall part removed (projection
  //    onto the wall plane). Looking straight at the wall → no boost, just up.
  const fwdX = -Math.sin(p.yaw);
  const fwdZ = -Math.cos(p.yaw);
  const dot = fwdX * wall.nx + fwdZ * wall.nz;
  let tx = fwdX - dot * wall.nx;
  let tz = fwdZ - dot * wall.nz;
  const tLen = Math.hypot(tx, tz);
  if (tLen > 0.3) {
    tx /= tLen;
    tz /= tLen;
    const boost = boostAt(horizontalSpeed(p), tuning.wallJumpBoost);
    p.vx += tx * boost;
    p.vz += tz * boost;
  }

  // 3. A small push off the wall (so you don't scrape along it) and the kick up.
  p.vx += wall.nx * tuning.wallJumpPush;
  p.vz += wall.nz * tuning.wallJumpPush;
  p.vy = tuning.wallJumpUp;
  p.wallJumpsLeft--;
  p.wallJumpCooldownTicks = secondsToTicks(tuning.wallJumpCooldown);
  p.jumpBufferTicks = 0;
  return true;
}

/**
 * How much of a boost to give at the current speed. Full boost up to
 * bhopBoostFalloff, then it shrinks with the square of the speed:
 * at 2× the falloff speed you get 1/4 of it, at 3× 1/9... No hard cap, but
 * each extra m/s costs more and more hops: no 1000 km/h after two jumps.
 */
function boostAt(speed: number, boost: number): number {
  const ratio = tuning.bhopBoostFalloff / Math.max(speed, tuning.bhopBoostFalloff);
  return boost * ratio * ratio;
}

/** Adds speed in the direction we're already moving (horizontally). */
function addSpeedAlongVelocity(p: PlayerState, boost: number): void {
  const speed = horizontalSpeed(p);
  if (speed < 1) return; // standing still: no direction to boost
  const newSpeed = speed + boostAt(speed, boost);
  p.vx *= newSpeed / speed;
  p.vz *= newSpeed / speed;
}

/**
 * Air control (our addition to Quake's air movement): holding a direction
 * roughly where you're going turns your velocity toward it, keeping the same
 * speed. Precise landings, no "greasy" drift.
 * The effect scales with dot² (how aligned wish and velocity are): pure
 * strafing (A/D, wish perpendicular to velocity) is untouched, so
 * air-strafing still works exactly as before.
 */
function airSteer(p: PlayerState, wishX: number, wishZ: number, dt: number): void {
  if (wishX === 0 && wishZ === 0) return;
  const speed = horizontalSpeed(p);
  if (speed < 0.1) return;
  const dirX = p.vx / speed;
  const dirZ = p.vz / speed;
  const dot = dirX * wishX + dirZ * wishZ;

  if (dot > 0) {
    const k = Math.min(1, tuning.airControl * dot * dot * dt);
    let nx = dirX + (wishX - dirX) * k;
    let nz = dirZ + (wishZ - dirZ) * k;
    const len = Math.hypot(nx, nz);
    nx /= len;
    nz /= len;
    p.vx = nx * speed;
    p.vz = nz * speed;
  }
}

/** Spare rounds at the start: only for the weapons you start with (the shotgun's come when you buy it). */
function startingReserve(): Record<AmmoType, number> {
  return { bullets: tuning.revolverReserveStart, shells: 0 };
}

/** Every weapon full (the ones you don't own too: they come loaded when you buy them). */
function fullWeapons(): Record<WeaponId, number> {
  return { revolver: tuning.revolverAmmo, shotgun: tuning.shotgunAmmo, rifle: tuning.rifleAmmo };
}

/** You start with the revolver only. */
function startingWeapons(): Record<WeaponId, boolean> {
  return { revolver: true, shotgun: false, rifle: false };
}

export function respawn(p: PlayerState, world: World): void {
  p.airTicks = 0;
  p.x = world.spawn.x;
  p.y = world.spawn.y;
  p.z = world.spawn.z;
  p.vx = p.vy = p.vz = 0;
  p.crouched = false;
  p.sliding = false;
  p.health = tuning.playerMaxHealth;
  p.loaded = fullWeapons();
  p.reserve = startingReserve();
  p.adsTicks = 0;
  p.owned = startingWeapons(); // dead = start over: what you bought is gone
  p.weapon = 'revolver';
  p.money = 0; // dead = the game starts over: empty pockets
  p.cards = noCards(); // ...and plain weapons
  p.reloadTicks = 0;
  p.fanShotsLeft = 0;
  p.fanQueued = false;
  p.slideReloadTicks = 0;
  p.wallJumpShot = false;
  p.leadFlightShells = 0;
  p.switchTicks = 0;
  p.kickTicks = 0;
  p.kickCooldownTicks = 0;
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

/** Damages the player and pushes them away from (fromX, fromZ). */
export function hurtPlayer(p: PlayerState, amount: number, fromX: number, fromZ: number, push: number): void {
  p.health = Math.max(0, p.health - amount);
  const dx = p.x - fromX;
  const dz = p.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  p.vx += (dx / d) * push;
  p.vz += (dz / d) * push;
  p.vy = Math.max(p.vy, 2); // a little hop: the hit lifts you off your feet
  p.onGround = false;
}
