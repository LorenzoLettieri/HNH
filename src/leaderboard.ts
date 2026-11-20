// Leaderboard: the best games, with the player's name.
//
// STEP 1 (now): a FAKE backend that keeps the scores in this browser's
// localStorage. Only you see them, but the rest of the game already talks to
// it the way it will talk to the real one: through two async functions,
// submitScore() and fetchTop(). Async = they return a Promise, like fetch():
// when the real server arrives only the inside of these two functions changes
// (a fetch() to a Cloudflare Worker), not who calls them.
//
// The client is NOT trusted: a score sent from the browser can be anything
// (anyone can call fetch() from the console). Good enough among friends; the
// real check will be on the server (see docs/DESIGN.md, "Classifica").

/** One row of the leaderboard. Plain data: it will travel as JSON. */
export interface ScoreEntry {
  name: string;
  score: number;
  wave: number;
  kills: number;
  /** When the game ended, ms since 1970 (Date.now()). */
  date: number;
}

/** What the game sends at the end of a run (the date is added here). */
export type ScoreSubmit = Omit<ScoreEntry, 'date'>;

/** How many rows the leaderboard keeps. */
export const LEADERBOARD_SIZE = 10;
/** Longest name accepted (the server will enforce the same). */
export const NAME_MAX_LENGTH = 16;
/** Name used when the player didn't write one. */
export const DEFAULT_NAME = 'Pistolero';

const STORAGE_KEY = 'hnh.leaderboard';

/**
 * A name fit to show: no spaces at the ends, no control characters, not too
 * long, never empty. Applied both when you type it and when it's sent.
 */
export function cleanName(name: string): string {
  // \p{Cc} = "control characters" (newlines, tabs...): Unicode property escape, needs the u flag.
  const clean = name.replace(/\p{Cc}/gu, '').trim().slice(0, NAME_MAX_LENGTH);
  return clean === '' ? DEFAULT_NAME : clean;
}

/** Best first; same score: the one who got there first stays ahead. */
function compare(a: ScoreEntry, b: ScoreEntry): number {
  return b.score - a.score || a.date - b.date;
}

// --- Fake backend (localStorage) -------------------------------------------

function load(): ScoreEntry[] {
  // Like settings.ts: storage can throw and the saved text can be anything.
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** A type guard: "if this returns true, TypeScript may treat `v` as a ScoreEntry". */
function isEntry(v: unknown): v is ScoreEntry {
  const e = v as ScoreEntry;
  return typeof v === 'object' && v !== null && typeof e.name === 'string'
    && [e.score, e.wave, e.kills, e.date].every(Number.isFinite);
}

function save(entries: ScoreEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Can't save (private mode): the leaderboard just doesn't remember.
  }
}

// --- API used by the game --------------------------------------------------

/**
 * Sends the result of a game. Resolves to its position (1 = first) or null
 * if it didn't make the leaderboard. Games with 0 points aren't sent at all.
 */
export async function submitScore(run: ScoreSubmit): Promise<number | null> {
  if (run.score <= 0) return null;
  const entry: ScoreEntry = { ...run, name: cleanName(run.name), date: Date.now() };
  const entries = [...load(), entry].sort(compare).slice(0, LEADERBOARD_SIZE);
  save(entries);
  const index = entries.indexOf(entry); // same object: -1 if it was cut off
  return index === -1 ? null : index + 1;
}

/** The leaderboard, best first. */
export async function fetchTop(): Promise<ScoreEntry[]> {
  return load().sort(compare).slice(0, LEADERBOARD_SIZE);
}
