// The leaderboard server: a Cloudflare Worker.
//
// A Worker is ONE function, fetch(request) → response, that Cloudflare runs
// on its machines for every HTTP request. No server to keep running: like a
// Laravel app where public/index.php is all there is, and the routes are the
// `if`s below. Three routes:
//   GET  /scores?limit=25        → the leaderboard: ONE row per player (name),
//                                  their best game, best first (limit 1..50, default 10)
//   GET  /scores/player?name=X   → that player's best game, with its position: { ..., rank, total }
//   POST /scores                 → { name, score, wave, kills } → { rank, total, personalBest }
//                                  (rank of the player's best, which is this game if personalBest)
// Every game is stored (the table keeps the whole history); the "one row per
// player" is decided when reading, by the queries below.
//
// The client is NOT trusted: anyone can POST any number. Here we only keep out
// what is clearly wrong (bad types, impossible numbers, junk names); a real
// check (replaying the game) is for later, see docs/DESIGN.md "Classifica".

/** What the Worker gets from wrangler.jsonc: the database and the vars. */
interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
}

// Same rules as src/leaderboard.ts in the game (the server is the one that counts).
/** Rows of GET /scores when the client doesn't say, and the most it may ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const NAME_MAX_LENGTH = 16;
const DEFAULT_NAME = 'Pistolero';

// "Impossible" limits: far above anything a real game reaches, they only stop
// typos and silly cheats (score: 1e300).
const MAX_SCORE = 100_000_000;
const MAX_WAVE = 1000;
const MAX_KILLS = 1_000_000;
/** Longest body accepted: a valid one is ~70 bytes. */
const MAX_BODY_BYTES = 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    // The browser's "preflight": before a cross-site POST with a JSON body it
    // asks "may I?" with an OPTIONS request; the CORS headers are the answer.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/scores') {
      if (request.method === 'GET') {
        // ?limit=25: a query-string parameter, like $request->query('limit').
        // Too many → the most allowed; not a number → the default.
        const asked = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
        const limit = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
        return json(await top(env.DB, limit), 200, cors);
      }
      if (request.method === 'POST') return submit(request, env.DB, cors);
      return json({ error: 'method not allowed' }, 405, cors);
    }
    if (url.pathname === '/scores/player' && request.method === 'GET') {
      const best = await playerBest(env.DB, cleanName(url.searchParams.get('name') ?? ''));
      return best ? json({ ...best, ...(await position(env.DB, best)) }, 200, cors) : json({ error: 'not found' }, 404, cors);
    }
    return json({ error: 'not found' }, 404, cors);
  },
} satisfies ExportedHandler<Env>;

/**
 * Every player's best game. A CTE (WITH ... AS) is a named sub-query, like a
 * temporary view. ROW_NUMBER() OVER (PARTITION BY ...) is a "window
 * function": it numbers the rows inside each group (here: each name, upper
 * or lower case doesn't matter) in the given order, without collapsing them
 * like GROUP BY would. Row number 1 of each group = that player's best game.
 * (Eloquent has no shortcut for this: in Laravel it would be a DB::raw too.)
 */
const BEST = `WITH best AS (
  SELECT id, name, score, wave, kills, created_at AS date,
         ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY score DESC, id ASC) AS n
  FROM scores
)`;

interface Row {
  id: number;
  name: string;
  score: number;
  wave: number;
  kills: number;
  date: number;
}

/** The leaderboard: best first; same score: who got there first (lower id). */
async function top(db: D1Database, limit: number): Promise<Row[]> {
  const { results } = await db
    .prepare(`${BEST} SELECT id, name, score, wave, kills, date FROM best WHERE n = 1 ORDER BY score DESC, id ASC LIMIT ?`)
    .bind(limit)
    .all<Row>();
  return results;
}

/** A player's best game, or null if that name never played. */
async function playerBest(db: D1Database, name: string): Promise<Row | null> {
  return db
    .prepare(`${BEST} SELECT id, name, score, wave, kills, date FROM best WHERE n = 1 AND lower(name) = lower(?)`)
    .bind(name)
    .first<Row>();
}

/**
 * Position of a player's best game = how many players have a better best,
 * + 1 (same order as top()), and how many players there are. db.batch()
 * sends both queries in one trip to the database instead of two.
 */
async function position(db: D1Database, best: Row): Promise<{ rank: number; total: number }> {
  const [ahead, all] = await db.batch<{ c: number }>([
    db.prepare(`${BEST} SELECT COUNT(*) AS c FROM best WHERE n = 1 AND (score > ?1 OR (score = ?1 AND id < ?2))`).bind(best.score, best.id),
    db.prepare(`${BEST} SELECT COUNT(*) AS c FROM best WHERE n = 1`),
  ]);
  return { rank: ahead.results[0].c + 1, total: all.results[0].c };
}

async function submit(request: Request, db: D1Database, cors: Headers): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'too large' }, 413, cors);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid json' }, 400, cors);
  }
  // Validation, like a Laravel FormRequest: every field checked, nothing
  // trusted. `as` only tells TypeScript the shape: the checks are the real thing.
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const score = integer(b.score, 1, MAX_SCORE);
  const wave = integer(b.wave, 0, MAX_WAVE);
  const kills = integer(b.kills, 0, MAX_KILLS);
  if (score === null || wave === null || kills === null || typeof b.name !== 'string') {
    return json({ error: 'invalid score' }, 422, cors);
  }
  const name = cleanName(b.name);

  // Prepared statement with ? placeholders: the values travel apart from the
  // SQL text, so a name like "'; DROP TABLE scores;--" stays just a name
  // (the same reason Eloquent/PDO bind parameters). RETURNING id = SQLite
  // gives back the new row's id in the same query.
  const row = await db
    .prepare('INSERT INTO scores (name, score, wave, kills, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(name, score, wave, kills, Date.now())
    .first<{ id: number }>();
  // Where does the player stand now? Their best game may be this one (a new
  // personal best) or an older one.
  const best = (await playerBest(db, name))!;
  return json({ ...(await position(db, best)), personalBest: best.id === row!.id }, 201, cors);
}

/** A whole number in [min, max], or null. */
function integer(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

function cleanName(name: string): string {
  const clean = name.replace(/\p{Cc}/gu, '').trim().slice(0, NAME_MAX_LENGTH);
  return clean === '' ? DEFAULT_NAME : clean;
}

/**
 * CORS: a page can only read answers from another site (here: the game on
 * github.io reading from workers.dev) if that site says it's allowed, with
 * Access-Control-Allow-Origin. We answer it only to the pages we know
 * (ALLOWED_ORIGINS). Note: this stops other WEBSITES, not people: curl or a
 * script doesn't care about CORS. It's the job of config/cors.php in Laravel.
 */
function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400'); // the browser may skip the preflight for a day
  }
  return headers;
}

function json(data: unknown, status: number, headers: Headers): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(data), { status, headers: h });
}
