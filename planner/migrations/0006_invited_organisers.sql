CREATE TABLE organisers (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'organiser')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX organisers_single_owner ON organisers(role) WHERE role='owner';

INSERT INTO organisers (id,username,salt,verifier,iterations,role,active,created_at,updated_at)
SELECT 'legacy-owner',username,salt,verifier,iterations,'owner',1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM organiser WHERE id=1;

ALTER TABLE events ADD COLUMN organiser_id TEXT REFERENCES organisers(id);
ALTER TABLE media ADD COLUMN organiser_id TEXT REFERENCES organisers(id);
ALTER TABLE sessions ADD COLUMN organiser_id TEXT REFERENCES organisers(id);

UPDATE events SET organiser_id='legacy-owner' WHERE EXISTS (SELECT 1 FROM organisers WHERE id='legacy-owner');
UPDATE media SET organiser_id='legacy-owner' WHERE EXISTS (SELECT 1 FROM organisers WHERE id='legacy-owner');
UPDATE sessions SET organiser_id='legacy-owner' WHERE role='admin'
  AND EXISTS (SELECT 1 FROM organisers WHERE id='legacy-owner');

CREATE INDEX events_organiser ON events(organiser_id,created_at);
CREATE INDEX media_organiser ON media(organiser_id,event_id);
CREATE INDEX sessions_organiser ON sessions(organiser_id);

CREATE TABLE account_invitations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('owner', 'organiser', 'reset')),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  target_organiser_id TEXT REFERENCES organisers(id),
  created_by TEXT REFERENCES organisers(id),
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX account_invitations_pending ON account_invitations(kind,expires_at);
