ALTER TABLE locations ADD COLUMN website_url TEXT NOT NULL DEFAULT '';
ALTER TABLE locations ADD COLUMN osm_url TEXT NOT NULL DEFAULT '';
CREATE TABLE import_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE import_locks (
  provider TEXT PRIMARY KEY,
  next_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
