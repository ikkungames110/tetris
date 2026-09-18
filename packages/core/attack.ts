import { occupied } from './pieces';
import type { Player, Spin } from './types';

export function detectSpin(player: Player): Spin {
  const a = player.active;
  if (!a || a.type !== 'T' || player.rotationKick === null) return 'none';
  const cx = a.x + 1;
  const cy = a.y + 1;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => occupied(player.board, cx + x, cy + y));
  if (corners.filter(Boolean).length < 3) return 'none';
  const front = corners[a.rotation] && corners[(a.rotation + 1) % 4];
  return front || player.rotationKick === 5 ? 'full' : 'mini';
}

export function calculateAttack(
  lines: number,
  spin: Spin,
  perfect: boolean,
  previousB2b: boolean,
  ren: number,
): number {
  if (!lines) return 0;
  if (perfect) return 10;
  const base =
    spin === 'full'
      ? [0, 2, 4, 6][lines]
      : spin === 'mini'
        ? [0, 0, 1][lines]
        : [0, 0, 1, 2, 4][lines];
  const difficult = lines === 4 || spin !== 'none';
  const adjustedBase = (base ?? 0) + (difficult && previousB2b ? 1 : 0);
  if (adjustedBase === 0) return ren < 2 ? 0 : Math.floor(Math.log(1 + 1.25 * ren));
  return Math.floor(adjustedBase * (1 + 0.15 * ren));
}

export function cancelGarbage(player: Player, attack: number): number {
  let remaining = attack;
  for (const item of player.incoming) {
    const amount = Math.min(item.lines, remaining);
    item.lines -= amount;
    remaining -= amount;
  }
  player.incoming = player.incoming.filter((item) => item.lines > 0);
  player.stats.cancelled += attack - remaining;
  return remaining;
}
