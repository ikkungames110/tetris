import type { D1Database } from '@cloudflare/workers-types';
import { ratingTransfer } from '../../packages/core/rating';
import type { RatingResult } from '../../packages/protocol/online';

export interface RatingPlayer {
  id: string | null;
  rating: number | null;
}
export interface MatchResult {
  matchId: string;
  players: [RatingPlayer, RatingPlayer];
  winner: number;
}

export async function saveMatchResult(db: D1Database, result: MatchResult): Promise<RatingResult> {
  const { players, winner, matchId } = result;
  const rated =
    players.every((p) => p.id !== null && p.rating !== null) && players[0].id !== players[1].id;
  const transfer = rated ? ratingTransfer(players[winner].rating!, players[1 - winner].rating!) : 0;
  const statements = players.flatMap((player, seat) => {
    if (!player.id) return [];
    const change = seat === winner ? transfer : -transfer;
    return [
      db
        .prepare(
          `INSERT INTO random_results (user_id, match_id, won, completed_at, rating_before, rating_after)
        SELECT id, ?, ?, ?, CASE WHEN ? THEN rating ELSE NULL END,
          CASE WHEN ? THEN MAX(0, rating + ?) ELSE NULL END FROM users WHERE id = ?
        ON CONFLICT(user_id, match_id) DO NOTHING`,
        )
        .bind(
          matchId,
          seat === winner ? 1 : 0,
          Date.now(),
          rated ? 1 : 0,
          rated ? 1 : 0,
          change,
          player.id,
        ),
      db
        .prepare(
          `UPDATE users SET
          rating = (SELECT rating_after FROM random_results WHERE user_id = ? AND match_id = ?),
          peak_rating = MAX(peak_rating, (SELECT rating_after FROM random_results WHERE user_id = ? AND match_id = ?)),
          rated_matches = rated_matches + 1
        WHERE id = ? AND EXISTS (SELECT 1 FROM random_results WHERE user_id = ? AND match_id = ? AND rating_applied = 0 AND rating_after IS NOT NULL)`,
        )
        .bind(player.id, matchId, player.id, matchId, player.id, player.id, matchId),
      db
        .prepare('UPDATE random_results SET rating_applied = 1 WHERE user_id = ? AND match_id = ?')
        .bind(player.id, matchId),
    ];
  });
  // Both accounts, their peaks and the idempotency markers commit together.
  if (statements.length) await db.batch(statements);
  const rows = await Promise.all(
    players.map((player) =>
      db
        .prepare(
          'SELECT rating_before, rating_after FROM random_results WHERE user_id = ? AND match_id = ?',
        )
        .bind(player.id, matchId)
        .first<{ rating_before: number | null; rating_after: number | null }>(),
    ),
  );
  return {
    type: 'rating',
    matchId,
    rated,
    winner,
    ratings: rows.map(
      (row, i) => row?.rating_after ?? players[i].rating,
    ) as RatingResult['ratings'],
    changes: rows.map((row) =>
      row?.rating_after == null ? 0 : row.rating_after - row.rating_before!,
    ) as [number, number],
  };
}
