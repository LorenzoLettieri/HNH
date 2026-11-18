// Tuning constants for the simulation. One place to tweak how the game feels.

/** Simulation ticks per second. Independent of the monitor's refresh rate. */
export const TICK_RATE = 60;
/** Duration of one tick, in seconds. */
export const TICK_DT = 1 / TICK_RATE;

/** Ground speed, meters per second (temporary, no acceleration/physics yet). */
export const MOVE_SPEED = 6;
/** Camera height above the player's feet, meters. */
export const EYE_HEIGHT = 1.7;
