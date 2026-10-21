ALTER TABLE events ADD COLUMN mood TEXT NOT NULL DEFAULT 'minimal';
ALTER TABLE events ADD COLUMN greeting TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN decorations INTEGER NOT NULL DEFAULT 1;
ALTER TABLE locations ADD COLUMN latitude REAL;
ALTER TABLE locations ADD COLUMN longitude REAL;
ALTER TABLE locations ADD COLUMN place_id TEXT NOT NULL DEFAULT '';

CREATE TABLE organiser (
  id INTEGER PRIMARY KEY CHECK (id=1),
  username TEXT NOT NULL,
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  iterations INTEGER NOT NULL
);
CREATE TABLE request_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_end INTEGER NOT NULL
);
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX media_event ON media(event_id);
DELETE FROM sessions WHERE role='admin';
