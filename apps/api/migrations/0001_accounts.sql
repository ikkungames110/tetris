CREATE TABLE users (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('guest', 'member')),
  email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((kind = 'guest' AND email IS NULL AND password_hash IS NULL)
      OR (kind = 'member' AND email IS NOT NULL AND password_hash IS NOT NULL))
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE personal_bests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode = 'sprint'),
  ticks INTEGER NOT NULL CHECK (ticks > 0 AND ticks <= 216000),
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mode)
);
CREATE TABLE rate_limits (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
