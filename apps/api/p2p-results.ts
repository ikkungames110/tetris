import type { D1Database } from '@cloudflare/workers-types';
import { saveMatchResult } from './ratings';
import type { RatingResult } from '../../packages/protocol/online';

export const REPORT_WAIT_MS = 5000;
type Decision = {
  match_id: string;
  winner: number;
  player0: string | null;
  player1: string | null;
  rating0: number | null;
  rating1: number | null;
};

export async function randomDecision(db: D1Database, matchId: string): Promise<Decision | null> {
  return db
    .prepare('SELECT * FROM random_decisions WHERE match_id = ?')
    .bind(matchId)
    .first<Decision>();
}

// A unique decision freezes the outcome before applying either player's rating.
// HTTP retries and the scheduled recovery may race; saveMatchResult is idempotent.
export async function settleRandomReport(
  db: D1Database,
  matchId: string,
  now = Date.now(),
): Promise<RatingResult | null> {
  let decision = await randomDecision(db, matchId);
  if (!decision) {
    const { results: reports } = await db
      .prepare('SELECT * FROM random_reports WHERE match_id = ? ORDER BY created_at, seat')
      .bind(matchId)
      .all<{
        seat: number;
        user_id: string;
        opponent_id: string | null;
        winner: number;
        rating: number | null;
        created_at: number;
      }>();
    const first = reports[0];
    if (!first) return null;
    const deadline = first.created_at + REPORT_WAIT_MS;
    const paired = reports.length === 2 && reports[1].created_at <= deadline;
    if (!paired && now < deadline) return null;
    const players = [0, 1].map((seat) => {
      const report = reports.find((r) => r.seat === seat);
      return report?.user_id ?? first.opponent_id;
    });
    const ratings = await Promise.all(
      players.map(async (id, seat) => {
        const report = reports.find((r) => r.seat === seat);
        if (report) return report.rating;
        const row = await db
          .prepare("SELECT rating FROM users WHERE id = ? AND kind = 'member'")
          .bind(id)
          .first<{ rating: number }>();
        return row?.rating ?? null;
      }),
    );
    // With both reports use the first reported outcome (also for disagreements).
    // With only one, the reporting player wins even if they reported a loss.
    const winner = paired ? first.winner : first.seat;
    await db
      .prepare(
        `INSERT INTO random_decisions (match_id, winner, player0, player1, rating0, rating1)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(matchId, winner, ...players, ...ratings)
      .run();
    decision = (await randomDecision(db, matchId))!;
  }
  const result = await saveMatchResult(db, {
    matchId,
    winner: decision.winner,
    players: [
      { id: decision.player0, rating: decision.rating0 },
      { id: decision.player1, rating: decision.rating1 },
    ],
  });
  await db.batch([
    db.prepare('UPDATE random_decisions SET applied = 1 WHERE match_id = ?').bind(matchId),
    db.prepare('UPDATE random_reports SET finalized = 1 WHERE match_id = ?').bind(matchId),
  ]);
  return result;
}

export async function settlePendingRandomReports(db: D1Database): Promise<void> {
  const pending = await db
    .prepare(
      `SELECT match_id FROM random_decisions WHERE applied = 0
     UNION SELECT match_id FROM random_reports WHERE finalized = 0 AND created_at <= ? LIMIT 100`,
    )
    .bind(Date.now() - REPORT_WAIT_MS)
    .all<{ match_id: string }>();
  for (const { match_id } of pending.results) {
    try {
      await settleRandomReport(db, match_id);
    } catch {
      // Keep the durable pending marker; the next scheduled run retries it.
      console.error('Random result settlement failed');
    }
  }
}
