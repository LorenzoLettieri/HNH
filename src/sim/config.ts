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
