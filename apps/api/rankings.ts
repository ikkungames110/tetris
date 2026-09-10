import type { D1Database } from '@cloudflare/workers-types';
import type { AccountUser, Leaderboard, Rankings } from '../../packages/protocol/account';
import { playerName } from '../../packages/protocol/player-name';

interface RankedUser extends AccountUser {
  value: number;
}

function leaderboard(
  rows: RankedUser[],
  own: { rank: number; value: number } | undefined,
  userId: string,
): Leaderboard {
  let rank = 0;
  return {
    top: rows.map((row, index) => {
      if (index === 0 || row.value !== rows[index - 1].value) rank = index + 1;
      return { rank, name: playerName(row), value: row.value, isYou: row.id === userId };
    }),
    mine: own ?? null,
  };
}

export async function rankings(db: D1Database, user: AccountUser): Promise<Rankings> {
  // Each top-ten query follows a ranking index. Count only better
  // scores for the current user instead of sorting every player with a window.
  // D1 batch keeps both lists and the user's ranks in one consistent transaction.
  const [sprintTop, sprintMine, randomTop, randomMine] = await db.batch([
    db.prepare(`SELECT u.id, u.kind, u.email, p.ticks AS value FROM
      (SELECT user_id, ticks, achieved_at FROM personal_bests WHERE mode = 'sprint'
       ORDER BY ticks, achieved_at, user_id LIMIT 10) p
      JOIN users u ON u.id = p.user_id ORDER BY p.ticks, p.achieved_at, p.user_id`),
    db
      .prepare(
        `SELECT p.ticks AS value, 1 +
      (SELECT COUNT(*) FROM personal_bests b WHERE b.mode = 'sprint' AND b.ticks < p.ticks) AS rank
      FROM personal_bests p WHERE p.user_id = ? AND p.mode = 'sprint'`,
      )
      .bind(user.id),
    db.prepare(`SELECT id, kind, email, rating AS value FROM users WHERE kind = 'member'
      ORDER BY rating DESC, id LIMIT 10`),
    db
      .prepare(
        `SELECT u.rating AS value, 1 +
      (SELECT COUNT(*) FROM users b WHERE b.kind = 'member' AND b.rating > u.rating) AS rank
      FROM users u WHERE u.id = ? AND u.kind = 'member'`,
      )
      .bind(user.id),
  ]);
  return {
    sprint: leaderboard(
      sprintTop.results as unknown as RankedUser[],
      sprintMine.results[0] as { rank: number; value: number } | undefined,
      user.id,
    ),
    random: leaderboard(
      randomTop.results as unknown as RankedUser[],
      randomMine.results[0] as { rank: number; value: number } | undefined,
      user.id,
    ),
  };
}
