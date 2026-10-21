PRAGMA foreign_keys = ON;

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  occasion TEXT NOT NULL,
  theme TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  maps_url TEXT NOT NULL,
  menu_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  image_urls TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL
);
CREATE INDEX locations_event ON locations(event_id, position);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  invite_hash TEXT UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, name COLLATE NOCASE)
);
CREATE INDEX participants_event ON participants(event_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin','participant')),
  participant_id TEXT REFERENCES participants(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_participant ON sessions(participant_id);

CREATE TABLE ratings (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (participant_id, location_id)
);
CREATE INDEX ratings_location ON ratings(location_id);
