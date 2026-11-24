// Fair play: does this game count for the leaderboard?
//
// A game played with the debug tools (free weapons, slow motion, tuning
// changed in the debug panel, enemies spawned by hand...) is a "practice"
// game: it's played normally but its score is not sent.
//
// This is a courtesy check, not an anti-cheat: it runs in the browser, so
// anyone can switch it off. It only keeps OUR tests out of the leaderboard.
// Client-side only (not in src/sim/): the simulation doesn't care, only the
// part of the game that talks to the leaderboard does.
import { tuning } from './sim/config';

/** URL parameters that change the game (see main.ts). Any of them = practice. */
const DEBUG_PARAMS = ['level', 'seed', 'slow', 'guns', 'pos', 'look', 'drinks'];

/**
 * The tuning values as they are in config.ts, taken once when the game loads
 * (before the debug panel can touch them). JSON.stringify turns the whole
 * object into one string: comparing two strings = comparing every value.
 */
const TUNING_AT_START = JSON.stringify(tuning);

/** Why the current game doesn't count (null = it counts). */
let practiceReason: string | null = null;

/** Marks the current game as practice. The first reason is kept. */
export function markPractice(reason: string): void {
  practiceReason ??= reason; // ??= assigns only if it's still null
}

/** Checks the tuning against config.ts: changed = practice. */
export function checkTuning(): void {
  if (JSON.stringify(tuning) !== TUNING_AT_START) markPractice('valori di debug cambiati');
}

/** Why this game doesn't count, or null if it counts. Checks the tuning one last time. */
export function practiceGame(): string | null {
  checkTuning();
  return practiceReason;
}

/**
 * A new game starts (at load and after every death). The URL parameters
 * stay for the whole session, so they mark every game again.
 */
export function startGame(): void {
  practiceReason = null;
  const params = new URLSearchParams(location.search);
  const used = DEBUG_PARAMS.find((p) => params.has(p));
  if (used) markPractice(`?${used} nell'indirizzo`);
}
