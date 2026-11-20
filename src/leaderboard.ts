// Leaderboard: the best games, with the player's name.
//
// The scores live on our server, a Cloudflare Worker (server/ in the repo,
// see server/README.md). The game talks to it with async functions:
//   submitScore() → POST /scores, answers with where the player stands
//   fetchTop()    → GET  /scores?limit=N, ONE row per player: their best game
//   fetchPlayer() → GET  /scores/player?name=X, a player's best with its position
// A player = a name (upper/lower case don't matter): no accounts, so whoever
// uses your nickname plays as you. Fine among friends.
// Both can fail (offline, server down, too slow): callers must cope, and the
// game never waits for them.
//
// The client is NOT trusted: a score sent from the browser can be anything
// (anyone can call fetch() from the console). Good enough among friends; the
// real check will be on the server (see docs/DESIGN.md, "Classifica").

/** Where the Worker answers (printed by `npm run deploy` in server/). */
export const LEADERBOARD_URL = 'https://hnh-leaderboard.hnh-leaderboard.workers.dev';
/** Give up after this long: better no leaderboard than a hanging request. */
const TIMEOUT_MS = 5000;

/** One row of the leaderboard. Plain data: it will travel as JSON. */
export interface ScoreEntry {
  /** The row's id on the server (1, 2, 3... in order of arrival). */
  id: number;
  name: string;
  score: number;
  wave: number;
  kills: number;
  /** When the game ended, ms since 1970 (Date.now()). */
  date: number;
}

/** What the game sends at the end of a run (the date is added here). */
export type ScoreSubmit = Omit<ScoreEntry, 'id' | 'date'>;

/** Where a player stands: rank 1 = first, out of `total` players. */
export interface Placement {
  rank: number;
  total: number;
}

/** The answer to a submit: where you stand now, and whether this game is your new best. */
export interface SubmitResult extends Placement {
  personalBest: boolean;
}
/** Longest name accepted (the server will enforce the same). */
export const NAME_MAX_LENGTH = 16;
/** Name used when the player didn't write one. */
export const DEFAULT_NAME = 'Pistolero';

/**
 * A name fit to show: no spaces at the ends, no control characters, not too
 * long, never empty. Applied both when you type it and when it's sent.
 */
export function cleanName(name: string): string {
  // \p{Cc} = "control characters" (newlines, tabs...): Unicode property escape, needs the u flag.
  const clean = name.replace(/\p{Cc}/gu, '').trim().slice(0, NAME_MAX_LENGTH);
  return clean === '' ? DEFAULT_NAME : clean;
}

/** Same player? Names compared like the server does: case doesn't matter. */
export function samePlayer(a: string, b: string): boolean {
  return cleanName(a).toLowerCase() === cleanName(b).toLowerCase();
}

// --- API used by the game --------------------------------------------------

/**
 * Sends the result of a game. Resolves to where the player stands now, or
 * null if the server didn't say. Rejects (throws) if it can't be reached.
 */
export async function submitScore(run: ScoreSubmit): Promise<SubmitResult | null> {
  const answer = (await request('POST', '/scores', { ...run, name: cleanName(run.name) })) as Partial<SubmitResult>;
  if (typeof answer.rank !== 'number' || typeof answer.total !== 'number') return null;
  return { rank: answer.rank, total: answer.total, personalBest: answer.personalBest === true };
}

/** The leaderboard (one row per player), best first. Rejects if the server can't be reached. */
export async function fetchTop(limit: number): Promise<ScoreEntry[]> {
  return (await request('GET', `/scores?limit=${limit}`)) as ScoreEntry[];
}

/** A player's best game with its position. Rejects if unreachable or the name never played. */
export async function fetchPlayer(name: string): Promise<ScoreEntry & Placement> {
  // encodeURIComponent: a name like "Doc & Wyatt" must not break the URL (& starts a new parameter).
  return (await request('GET', `/scores/player?name=${encodeURIComponent(cleanName(name))}`)) as ScoreEntry & Placement;
}

/**
 * One call to the Worker. fetch() only rejects when the request doesn't
 * happen at all (no network, CORS refused, timeout): an HTTP error like 422
 * or 500 is still a "successful" fetch, so `ok` (status 200–299) is checked
 * by hand. AbortSignal.timeout = the request is cancelled after TIMEOUT_MS.
 */
async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${LEADERBOARD_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`leaderboard: HTTP ${response.status}`);
  return response.json();
}
