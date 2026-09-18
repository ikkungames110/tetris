CREATE TABLE random_reports (
  match_id TEXT NOT NULL,
  seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  winner INTEGER NOT NULL CHECK (winner IN (0, 1)),
  rating INTEGER CHECK (rating >= 0),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, seat),
  UNIQUE (match_id, user_id)
);
CREATE INDEX random_reports_user ON random_reports(user_id);
