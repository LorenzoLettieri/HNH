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
import { hitStopSettings } from './render/hitStop';

/**
 * URL parameters that change the game (see main.ts). Any of them = practice.
 * `as const` keeps the exact strings: DebugParam below is the union
 * 'level' | 'seed' | ... and main.ts can read a parameter only through
 * debugParam(), so a new debug parameter that isn't in this list is a
 * compile error, not a cheat that ends up on the leaderboard (the bug of
 * ?forged=all, forgotten here).
 */
const DEBUG_PARAMS = ['level', 'seed', 'slow', 'guns', 'forged', 'pos', 'look', 'drinks'] as const;
export type DebugParam = (typeof DEBUG_PARAMS)[number];

const urlParams = new URLSearchParams(location.search);

/** Reads a debug parameter from the URL (null = not there). The only way main.ts reads the URL. */
export function debugParam(name: DebugParam): string | null {
  return urlParams.get(name);
}

/**
 * The debug panel's values that change how the game plays: the tuning of
 * config.ts and the hit-stop (it freezes the game's time while you keep
 * aiming: a long one is a slow motion). The other folders of the panel
 * (viewmodel, recoil, camera, post-processing, atmosphere) only change how
 * things look. (The slow motion has its own markPractice in debugPanel.ts.)
 */
function gameValues(): string {
  // JSON.stringify turns the objects into one string: comparing two strings = comparing every value.
  return JSON.stringify({ tuning, hitStopSettings });
}

/** The values as they are in the code, taken once when the game loads (before the debug panel can touch them). */
const VALUES_AT_START = gameValues();

/** Why the current game doesn't count (null = it counts). */
let practiceReason: string | null = null;

/** Marks the current game as practice. The first reason is kept. */
export function markPractice(reason: string): void {
  practiceReason ??= reason; // ??= assigns only if it's still null
}

/** Checks the tuning (and the hit-stop) against the code: changed = practice. */
export function checkTuning(): void {
  if (gameValues() !== VALUES_AT_START) markPractice('valori di debug cambiati');
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
  const used = DEBUG_PARAMS.find((p) => urlParams.has(p));
  if (used) markPractice(`?${used} nell'indirizzo`);
}
