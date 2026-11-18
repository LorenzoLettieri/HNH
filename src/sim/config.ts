// Tuning constants for the simulation. One place to tweak how the game feels.

/** Simulation ticks per second. Independent of the monitor's refresh rate. */
export const TICK_RATE = 60;
/** Duration of one tick, in seconds. */
export const TICK_DT = 1 / TICK_RATE;

/** Camera height above the player's feet, meters. */
export const EYE_HEIGHT = 1.7;

// --- Ground movement (Quake-style) ------------------------------------------
/** Target speed when holding a direction on the ground, m/s. */
export const MAX_GROUND_SPEED = 8;
/**
 * How fast you reach MAX_GROUND_SPEED. Each second you gain up to
 * GROUND_ACCEL × MAX_GROUND_SPEED m/s: 14 × 8 = 112 m/s² → full speed in ~0.07 s.
 */
export const GROUND_ACCEL = 14;
/** How fast you stop when releasing the keys. Higher = snappier stops. */
export const GROUND_FRICTION = 8;
/**
 * Below this speed, friction acts as if you were going this fast:
 * prevents the endless slow "creep" before stopping completely. m/s.
 */
export const STOP_SPEED = 2.5;

// --- Gravity & jumping -------------------------------------------------------
/** Downward acceleration, m/s². Real world is 9.8; games use more for snappier jumps. */
export const GRAVITY = 20;
/** Upward speed given by a jump, m/s. Jump height = JUMP_SPEED² / (2 × GRAVITY) ≈ 1.2 m. */
export const JUMP_SPEED = 7;
/**
 * true  = holding jump re-jumps automatically on landing (easy bunny hopping).
 * false = you must release and press again (timing-based, like classic Quake).
 */
export const AUTO_BHOP = true;

// --- Air movement (Quake-style) ----------------------------------------------
/** Air acceleration. Higher = more air control and faster strafe gains. */
export const AIR_ACCEL = 12;
/**
 * Max speed you can ADD along your wished direction while airborne, m/s.
 * Tiny on purpose: you can't simply fly forward faster, but turning while
 * strafing keeps finding "new" directions to accelerate in → air-strafing.
 */
export const AIR_SPEED_CAP = 0.8;
