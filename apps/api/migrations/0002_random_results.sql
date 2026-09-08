CREATE TABLE random_results (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  won INTEGER NOT NULL CHECK (won IN (0, 1)),
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, match_id)
);
