// Random numbers for the simulation, from a SEED.
//
// Why not Math.random()? The simulation must be deterministic: same starting
// state + same inputs → same result. That's what will let a server and its
// clients agree on what happens, and what makes a replay possible. Math.random()
// is a black box we can't save or restore.
//
// A seeded generator (PRNG, "pseudo-random number generator") is just a
// function that scrambles a number into the next one: the sequence LOOKS
// random, but from the same seed you always get the same sequence. Its whole
// state is one integer, stored in the GameState like everything else
// (serializable: send that integer and the other side continues the same sequence).
//
// Algorithm: mulberry32, a tiny and well-known 32-bit PRNG. The magic
// constants and shifts just mix the bits thoroughly; no need to understand them
// to use it.

/** Anything that carries the generator's state (the GameState does). */
export interface RandomState {
  rng: number;
}

/** Next random number in [0, 1), advancing the state. */
export function random(s: RandomState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Random integer in [0, n). */
export function randomInt(s: RandomState, n: number): number {
  return Math.floor(random(s) * n);
}

/**
 * A seed made from a few integers, mixed so that close inputs give unrelated
 * seeds ((7, 0, 1) and (7, 0, 2) must not start similar sequences). It's a
 * tiny HASH: the same numbers always give the same seed. Used where a random
 * choice must be stable, like the cards on the shop's counter (upgrades.ts).
 */
export function seedFrom(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h | 0;
}
