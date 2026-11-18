// Tuning values for the simulation. One place to tweak how the game feels.
//
// They live in ONE mutable object (`tuning`) instead of separate constants,
// so the debug panel can change them while the game runs. The values written
// here are the defaults the game starts with.

/** Simulation ticks per second. Independent of the monitor's refresh rate. Not tunable live. */
export const TICK_RATE = 60;
/** Duration of one tick, in seconds. */
export const TICK_DT = 1 / TICK_RATE;

export const tuning = {
  /** Camera height above the player's feet, meters. */
  eyeHeight: 1.7,

  // --- Player collision box ---
  /** Half the width of the player's box, meters (the box is 0.8 × 0.8 m). */
  playerRadius: 0.4,
  /** Height of the player's box, meters. */
  playerHeight: 1.8,
  /** Falling below this height means you left the level: respawn. */
  killY: -30,

  // --- Ground movement (Quake-style) ---
  /** Target speed when holding a direction on the ground, m/s. */
  maxGroundSpeed: 8,
  /**
   * How fast you reach maxGroundSpeed. Each second you gain up to
   * groundAccel × maxGroundSpeed m/s: 14 × 8 = 112 m/s² → full speed in ~0.07 s.
   */
  groundAccel: 14,
  /** How fast you stop when releasing the keys. Higher = snappier stops. */
  groundFriction: 10,
  /**
   * Below this speed, friction acts as if you were going this fast:
   * prevents the endless slow "creep" before stopping completely. m/s.
   */
  stopSpeed: 2.5,

  // --- Gravity & jumping ---
  /** Downward acceleration, m/s². Real world is 9.8; games use more for snappier jumps. */
  gravity: 20,
  /** Upward speed given by a jump, m/s. Jump height = jumpSpeed² / (2 × gravity) ≈ 1.2 m. */
  jumpSpeed: 7,
  /**
   * true  = holding jump re-jumps automatically on landing (easy bunny hopping).
   * false = you must release and press again (timing-based, like classic Quake).
   */
  autoBhop: false,
  /**
   * Coyote time: you can still jump for this long after walking off a ledge,
   * like the cartoon coyote running off a cliff. Seconds.
   */
  coyoteTime: 0.1,
  /**
   * Jump buffer: a jump pressed up to this long BEFORE landing still counts,
   * and fires on the landing tick. Seconds.
   */
  jumpBufferTime: 0.1,

  // --- Air movement (Quake-style) ---
  /** Air acceleration. Higher = more air control and faster strafe gains. */
  airAccel: 12,
  /**
   * Max speed you can ADD along your wished direction while airborne, m/s.
   * Tiny on purpose: you can't simply fly forward faster, but turning while
   * strafing keeps finding "new" directions to accelerate in → air-strafing.
   */
  airSpeedCap: 0.8,

  // --- Crouch ---
  /** Height of the collision box while crouched/sliding, meters (fits under 1.1 m). */
  crouchHeight: 1.0,
  /** Camera height while crouched/sliding, meters. */
  crouchEyeHeight: 0.85,
  /** Max walking speed while crouched (and too slow to slide), m/s. */
  crouchSpeed: 3.5,

  // --- Slide ---
  /** Minimum speed to start a slide instead of a plain crouch, m/s. */
  slideStartSpeed: 5,
  /** Speed added when a slide starts, m/s. */
  slideBoost: 3,
  /** The boost only applies below this speed: no infinite acceleration by spamming. m/s. */
  slideBoostMaxSpeed: 13,
  /** Seconds before another slide can give a boost again. */
  slideBoostCooldown: 0.6,
  /** Friction while sliding: much lower than on foot, so you keep your speed. */
  slideFriction: 0.7,
  /** Below this speed the slide ends and you're just crouching, m/s. */
  slideStopSpeed: 3,
  /** How much you can steer during a slide (like air control). */
  slideSteer: 6,

  // --- Wall jump ---
  /** How close a wall must be to jump off it, meters (beyond your body). */
  wallJumpReach: 0.35,
  /** Upward speed of a wall jump, m/s. */
  wallJumpUp: 6.5,
  /** Speed pushing you away from the wall, m/s. */
  wallJumpPush: 6,
  /** Wall jumps allowed before touching the ground again. */
  wallJumpsMax: 3,
  /** Minimum seconds between two wall jumps (else holding jump would burn them all at once). */
  wallJumpCooldown: 0.2,
};

/** Converts a duration in seconds to a whole number of ticks. */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}
