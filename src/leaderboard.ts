// Leaderboard: the best games, with the player's name.
//
// The scores live on our server, a Cloudflare Worker (server/ in the repo,
// see server/README.md). The game talks to it with two async functions:
//   submitScore() → POST /scores, answers with the position
//   fetchTop()    → GET  /scores, the top 10
//   fetchEntry()  → GET  /scores/:id, one row with its position
// Which rows are yours: the server answers every submit with the new row's
// id, and this browser remembers your ids (MINE_KEY). No accounts: clear the
// browser's data and the game forgets which rows were yours.
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

/** Where a score ended up: rank 1 = first, out of `total` scores. */
export interface Placement {
  rank: number;
  total: number;
}

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

// --- Your rows (remembered in this browser) --------------------------------

const MINE_KEY = 'hnh.myScores';
/** How many of your scores to remember (the best ones). */
const MINE_KEEP = 20;

interface MyScore {
  id: number;
  score: number;
}

function loadMine(): MyScore[] {
  // Like settings.ts: storage can throw and the saved text can be anything.
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(MINE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((m: MyScore) => Number.isInteger(m?.id) && Number.isFinite(m?.score)) : [];
  } catch {
    return [];
  }
}

function rememberMine(mine: MyScore): void {
  const all = [...loadMine(), mine].sort((a, b) => b.score - a.score).slice(0, MINE_KEEP);
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(all));
  } catch {
    // Can't save (private mode): your rows just won't be highlighted.
  }
}

/** Is this row one of yours? */
export function isMine(id: number): boolean {
  return loadMine().some((m) => m.id === id);
}

/** The id of your best score, or null if you never sent one from here. */
export function myBestId(): number | null {
  return loadMine()[0]?.id ?? null; // kept sorted, best first
}

// --- API used by the game --------------------------------------------------

/**
 * Sends the result of a game. Resolves to where it ended up, or null if the
 * server didn't say (games with 0 points aren't sent at all). Rejects
 * (throws) if the server can't be reached.
 */
export async function submitScore(run: ScoreSubmit): Promise<Placement | null> {
  if (run.score <= 0) return null;
  const answer = (await request('POST', '/scores', { ...run, name: cleanName(run.name) })) as Partial<Placement & { id: number }>;
  if (typeof answer.id === 'number') rememberMine({ id: answer.id, score: run.score });
  if (typeof answer.rank !== 'number' || typeof answer.total !== 'number') return null;
  return { rank: answer.rank, total: answer.total };
}

/** The leaderboard, best first. Rejects if the server can't be reached. */
export async function fetchTop(): Promise<ScoreEntry[]> {
  return (await request('GET', '/scores')) as ScoreEntry[];
}

/** One row with its position. Rejects if the server can't be reached or there's no such row. */
export async function fetchEntry(id: number): Promise<ScoreEntry & Placement> {
  return (await request('GET', `/scores/${id}`)) as ScoreEntry & Placement;
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
