// The leaderboard server: a Cloudflare Worker.
//
// A Worker is ONE function, fetch(request) → response, that Cloudflare runs
// on its machines for every HTTP request. No server to keep running: like a
// Laravel app where public/index.php is all there is, and the routes are the
// `if`s below. Three routes:
//   GET  /scores      → the top 10, JSON (each row with its id)
//   GET  /scores/:id  → one row with its position and how many there are: { ..., rank, total }
//   POST /scores      → { name, score, wave, kills } → { id, rank, total } (rank 1 = first)
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
const LEADERBOARD_SIZE = 10;
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
      if (request.method === 'GET') return json(await top(env.DB), 200, cors);
      if (request.method === 'POST') return submit(request, env.DB, cors);
      return json({ error: 'method not allowed' }, 405, cors);
    }
    // /scores/42: a route parameter, read with a regular expression (what
    // Laravel does for you with Route::get('/scores/{id}', ...)).
    const one = url.pathname.match(/^\/scores\/(\d+)$/);
    if (one && request.method === 'GET') {
      const row = await byId(env.DB, Number(one[1]));
      return row ? json(row, 200, cors) : json({ error: 'not found' }, 404, cors);
    }
    return json({ error: 'not found' }, 404, cors);
  },
} satisfies ExportedHandler<Env>;

/** The columns sent to the game (created_at is called `date` there). */
const COLUMNS = 'id, name, score, wave, kills, created_at AS date';

/** The top rows, best first; same score: who got there first (lower id). */
async function top(db: D1Database): Promise<unknown[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM scores ORDER BY score DESC, id ASC LIMIT ?`)
    .bind(LEADERBOARD_SIZE)
    .all();
  return results;
}

/** One row with its position, or null if there's no such id. */
async function byId(db: D1Database, id: number): Promise<unknown> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM scores WHERE id = ?`).bind(id).first<{ score: number }>();
  if (!row) return null;
  return { ...row, ...(await position(db, id, row.score)) };
}

/**
 * Position of a row = how many rows are ahead of it, + 1 (same order as
 * top()), and how many rows there are. db.batch() sends both queries in one
 * trip to the database instead of two.
 */
async function position(db: D1Database, id: number, score: number): Promise<{ rank: number; total: number }> {
  const [ahead, all] = await db.batch<{ n: number }>([
    db.prepare('SELECT COUNT(*) AS n FROM scores WHERE score > ?1 OR (score = ?1 AND id < ?2)').bind(score, id),
    db.prepare('SELECT COUNT(*) AS n FROM scores'),
  ]);
  return { rank: ahead.results[0].n + 1, total: all.results[0].n };
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
  // The game keeps the id: it's how it recognizes its own rows later.
  return json({ id: row!.id, ...(await position(db, row!.id, score)) }, 201, cors);
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
