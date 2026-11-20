-- Like a Laravel migration: run once per database, in file order
-- (`wrangler d1 migrations apply`, the `php artisan migrate` of D1).
-- D1 remembers which files it already ran, in its own table.
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  wave INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  created_at INTEGER NOT NULL -- ms since 1970 (Date.now())
);

-- The leaderboard is always read in this order: the index keeps the rows
-- already sorted, so "top 10" reads 10 rows instead of sorting the whole table.
CREATE INDEX scores_by_rank ON scores (score DESC, id ASC);
