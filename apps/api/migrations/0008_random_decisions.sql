ALTER TABLE random_reports ADD COLUMN opponent_id TEXT;
ALTER TABLE random_reports ADD COLUMN finalized INTEGER NOT NULL DEFAULT 0;
CREATE INDEX random_reports_opponent ON random_reports(opponent_id);
CREATE INDEX random_reports_pending ON random_reports(finalized, created_at);
CREATE TABLE random_decisions (
  match_id TEXT PRIMARY KEY,
  winner INTEGER NOT NULL CHECK (winner IN (0, 1)),
  player0 TEXT,
  player1 TEXT,
  rating0 INTEGER,
  rating1 INTEGER,
  applied INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX random_decisions_player0 ON random_decisions(player0);
CREATE INDEX random_decisions_player1 ON random_decisions(player1);
CREATE INDEX random_decisions_pending ON random_decisions(applied);
INSERT INTO random_decisions (match_id, winner, player0, player1, rating0, rating1, applied)
SELECT r.match_id, MIN(CASE WHEN result.won = 1 THEN r.seat ELSE 1 - r.seat END),
  MAX(CASE WHEN r.seat = 0 THEN r.user_id END),
  MAX(CASE WHEN r.seat = 1 THEN r.user_id END),
  MAX(CASE WHEN r.seat = 0 THEN r.rating END),
  MAX(CASE WHEN r.seat = 1 THEN r.rating END), 1
FROM random_reports r JOIN random_results result
  ON result.match_id = r.match_id AND result.user_id = r.user_id
GROUP BY r.match_id;
UPDATE random_reports SET finalized = 1
WHERE match_id IN (SELECT match_id FROM random_decisions);
