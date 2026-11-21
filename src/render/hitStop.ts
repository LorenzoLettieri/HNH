// Hit-stop: the whole game freezes for a few hundredths of a second when a
// heavy blow lands. Fighting games and Zelda do it on every hit: the eye
// gets an instant to "read" the impact, and the blow feels heavy instead of
// passing through. Sounds keep playing (they run on the audio clock), which
// makes it even punchier: you HEAR the bonk on a still picture.
//
// How: main.ts multiplies the frame's time by timeScale(), like the debug
// slow motion. 0 while the stop lasts: no time goes into the simulation's
// accumulator, and every animation gets dt = 0. The stop is counted in REAL
// time (frameTime), otherwise a frozen clock would never run out.
//
// It does touch the simulation's time, which is fine in single player. In
// multiplayer the server can't stop the world for one player: there it will
// have to become visual only (freeze the drawing, not the ticks).

/** Seconds of freeze for a shovel blow, plus a bit per extra enemy hit (capped). */
export const hitStopSettings = {
  shovel: 0.07,
  perExtraHit: 0.015,
  max: 0.12,
};

let left = 0; // seconds of freeze still to go

/** A blow landed: freeze for `seconds` (a new stop never shortens one in progress). */
export function requestHitStop(seconds: number): void {
  left = Math.max(left, Math.min(seconds, hitStopSettings.max));
}

/** Call once per frame with the REAL frame time: the factor to multiply the game's time by (0 or 1). */
export function hitStopScale(frameTime: number): number {
  if (left <= 0) return 1;
  left -= frameTime;
  return 0;
}
