CREATE TABLE room_directory (
  code TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  wins_required INTEGER NOT NULL,
  locked INTEGER NOT NULL,
  handicap TEXT NOT NULL,
  version INTEGER NOT NULL,
  rules TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX room_directory_expiry ON room_directory(expires_at);
