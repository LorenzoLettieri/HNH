// Leaderboard: the best games, with the player's name.
//
// The scores live on our server, a Cloudflare Worker (server/ in the repo,
// see server/README.md). The game talks to it with two async functions:
//   submitScore() → POST /scores, answers with the position
//   fetchTop()    → GET  /scores, the top 10
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

/**
 * A name fit to show: no spaces at the ends, no control characters, not too
 * long, never empty. Applied both when you type it and when it's sent.
 */
export function cleanName(name: string): string {
  // \p{Cc} = "control characters" (newlines, tabs...): Unicode property escape, needs the u flag.
  const clean = name.replace(/\p{Cc}/gu, '').trim().slice(0, NAME_MAX_LENGTH);
  return clean === '' ? DEFAULT_NAME : clean;
}

// --- API used by the game --------------------------------------------------

/**
 * Sends the result of a game. Resolves to its position (1 = first) or null
 * if it didn't make the leaderboard. Games with 0 points aren't sent at all.
 * Rejects (throws) if the server can't be reached.
 */
export async function submitScore(run: ScoreSubmit): Promise<number | null> {
  if (run.score <= 0) return null;
  const answer = await request('POST', { ...run, name: cleanName(run.name) });
  return (answer as { rank: number | null }).rank;
}

/** The leaderboard, best first. Rejects if the server can't be reached. */
export async function fetchTop(): Promise<ScoreEntry[]> {
  return (await request('GET')) as ScoreEntry[];
}

/**
 * One call to the Worker. fetch() only rejects when the request doesn't
 * happen at all (no network, CORS refused, timeout): an HTTP error like 422
 * or 500 is still a "successful" fetch, so `ok` (status 200–299) is checked
 * by hand. AbortSignal.timeout = the request is cancelled after TIMEOUT_MS.
 */
async function request(method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const response = await fetch(`${LEADERBOARD_URL}/scores`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`leaderboard: HTTP ${response.status}`);
  return response.json();
}
