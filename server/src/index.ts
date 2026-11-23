// The leaderboard server: a Cloudflare Worker.
//
// A Worker is ONE function, fetch(request) → response, that Cloudflare runs
// on its machines for every HTTP request. No server to keep running: like a
// Laravel app where public/index.php is all there is, and the routes are the
// `if`s below. Four routes:
//   GET   /scores?limit=25       → the leaderboard: ONE row per player (name),
//                                  their best game, best first (limit 1..50, default 10)
//   GET   /scores/player?name=X  → that player's best game, with its position: { ..., rank, total }
//   POST  /scores                → { name, score, wave, kills } → { rank, total, personalBest, id, token }
//                                  (rank of the player's best, which is this game if personalBest;
//                                  id + token = the "receipt" that lets you rename this game)
//   PATCH /scores/:id            → { name, token } → same answer as POST, for the new name
//                                  (the end screen: "that was me, not Randy Coffin")
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
  /**
   * The key that signs the rename receipts (see sign()). A SECRET, so not in
   * wrangler.jsonc (that's in the repo): set with `npx wrangler secret put
   * RENAME_SECRET`, locally in server/.dev.vars. Missing = renaming is off.
   */
  RENAME_SECRET?: string;
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
/** A game can be renamed up to this long after it ended (the end screen is for right after a game). */
const RENAME_WINDOW_MS = 30 * 60 * 1000;

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
      if (request.method === 'POST') return submit(request, env, cors);
      return json({ error: 'method not allowed' }, 405, cors);
    }
    // /scores/123: the route parameter of Route::patch('/scores/{id}'), by hand with a regex.
    const game = /^\/scores\/(\d+)$/.exec(url.pathname);
    if (game && request.method === 'PATCH') return rename(request, env, Number(game[1]), cors);
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

/** The JSON body as an object of unknown fields, or null if it's too big or not JSON. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

/** Where `name` stands now and whether game `id` is their best: the answer of POST and PATCH. */
async function placement(db: D1Database, name: string, id: number) {
  const best = (await playerBest(db, name))!;
  return { ...(await position(db, best)), personalBest: best.id === id };
}

async function submit(request: Request, env: Env, cors: Headers): Promise<Response> {
  // Validation, like a Laravel FormRequest: every field checked, nothing
  // trusted. `as` only tells TypeScript the shape: the checks are the real thing.
  const b = await readBody(request);
  if (!b) return json({ error: 'invalid body' }, 400, cors);
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
  const { id } = (await env.DB
    .prepare('INSERT INTO scores (name, score, wave, kills, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(name, score, wave, kills, Date.now())
    .first<{ id: number }>())!;
  // Where does the player stand now? Their best game may be this one (a new
  // personal best) or an older one. Plus the receipt: only whoever has the
  // token can rename this game later (no secret configured = no token).
  const token = env.RENAME_SECRET ? await sign(env.RENAME_SECRET, id) : null;
  return json({ ...(await placement(env.DB, name, id)), id, token }, 201, cors);
}

/**
 * Renames one game: { name, token }. The token proves you're the one who sent
 * it: the server gave it only in the answer to that POST. Without it anyone
 * could rename anyone's games (there are no accounts).
 */
async function rename(request: Request, env: Env, id: number, cors: Headers): Promise<Response> {
  if (!env.RENAME_SECRET) return json({ error: 'renaming is off' }, 503, cors);
  const b = await readBody(request);
  if (!b || typeof b.name !== 'string' || typeof b.token !== 'string') return json({ error: 'invalid body' }, 400, cors);
  if (!(await verify(env.RENAME_SECRET, id, b.token))) return json({ error: 'bad token' }, 403, cors);
  const game = await env.DB.prepare('SELECT created_at FROM scores WHERE id = ?').bind(id).first<{ created_at: number }>();
  if (!game) return json({ error: 'not found' }, 404, cors);
  if (Date.now() - game.created_at > RENAME_WINDOW_MS) return json({ error: 'too late' }, 403, cors);
  const name = cleanName(b.name);
  await env.DB.prepare('UPDATE scores SET name = ? WHERE id = ?').bind(name, id).run();
  return json(await placement(env.DB, name, id), 200, cors);
}

// --- Rename receipts: HMAC --------------------------------------------------
// An HMAC is a "signature" made with a secret key: HMAC(key, "score:42") gives
// a string that only who knows the key can compute, and any change to the
// message gives a completely different one. So the server doesn't have to
// remember the tokens it handed out (no table, no migration): it just signs
// the id again and compares. It's how Laravel's signed URLs work
// (URL::signedRoute: the ?signature= is an HMAC of the URL with APP_KEY).
// crypto.subtle = the Web Crypto API, built into Workers and browsers.

/** The HMAC-SHA256 key, from the secret's text. */
function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** What gets signed: the game's id (with a prefix, in case we ever sign other things). */
function receipt(id: number): Uint8Array {
  return new TextEncoder().encode(`score:${id}`);
}

/** The token of game `id`: its HMAC, as hex text (64 characters). */
async function sign(secret: string, id: number): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), receipt(id));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Is `token` the signature of game `id`? crypto.subtle.verify instead of
 * `token === await sign(...)`: a plain comparison stops at the first wrong
 * character, so how long it takes tells an attacker how many characters were
 * right ("timing attack"); verify always takes the same time.
 */
async function verify(secret: string, id: number, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const bytes = new Uint8Array(token.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, receipt(id));
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
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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
