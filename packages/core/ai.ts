import { cells, collides, HIDDEN, landing, rotate, WIDTH } from './pieces';
import { Button, NO_INPUT, type ActivePiece, type Cell, type Input, type Player } from './types';

export const AI_INTERVALS = [30, 18, 10, 6, 3, 2, 1.5, 1] as const;
export type AiLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

function stackHeight(board: Cell[][]): number {
  const top = board.findIndex((row) => row.some((cell) => cell !== null));
  return top < 0 ? 0 : board.length - top;
}

// Every level uses the same evaluation and legal move search.
function evaluate(board: Cell[][], piece: ActivePiece, digging: boolean): number {
  const fixed = cells(landing(board, piece));
  const copy = board.map((row) => [...row]);
  for (const [x, y] of fixed) copy[y + HIDDEN][x] = piece.type;
  const remaining = copy.filter((row) => row.some((cell) => cell === null));
  const lines = copy.length - remaining.length;
  const heights = Array<number>(WIDTH).fill(0);
  let holes = 0;
  let coveredBlocks = 0;
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < remaining.length; y++) {
      if (remaining[y][x] !== null) heights[x] ||= remaining.length - y;
      else if (heights[x]) holes++;
    }
  }
  // Count the blocks that must be removed to expose buried holes, including garbage holes.
  for (let x = 0; x < WIDTH; x++) {
    let holeBelow = false;
    for (let y = remaining.length - 1; y >= 0; y--) {
      if (remaining[y][x] === null) holeBelow = true;
      else if (holeBelow) coveredBlocks++;
    }
  }
  const bumpiness = heights
    .slice(1)
    .reduce((sum, height, i) => sum + Math.abs(height - heights[i]), 0);
  // Use the mode chosen BEFORE placement: a clear crossing the height threshold
  // must still receive the digging reward.
  const clearReward = (digging ? [0, 40, 85, 135, 220] : [0, -8, 16, 48, 150])[lines];
  const well = Math.max(
    Math.min(4, Math.max(0, Math.min(...heights.slice(1)) - heights[0])),
    Math.min(4, Math.max(0, Math.min(...heights.slice(0, -1)) - heights[WIDTH - 1])),
  );
  return (
    clearReward +
    (digging ? 0 : well * 4) -
    holes * (digging ? 18 : 12) -
    coveredBlocks * (digging ? 2.5 : 0.5) -
    heights.reduce((a, b) => a + b, 0) * (digging ? 1 : 0.6) -
    bumpiness * 0.8 -
    Math.max(...heights) * (digging ? 4 : 1.5) -
    (fixed.every(([, y]) => y < 0) ? 10000 : 0)
  );
}

export function planAi(player: Player, digging = stackHeight(player.board) >= 10): number[] {
  if (!player.active || player.dead) return [];
  const queue: { piece: ActivePiece; path: number[] }[] = [{ piece: player.active, path: [] }];
  const seen = new Set<string>();
  let best = -Infinity;
  let path: number[] = [Button.hard];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const key = `${current.piece.x}:${current.piece.y}:${current.piece.rotation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = evaluate(player.board, current.piece, digging);
    if (score > best) {
      best = score;
      path = [...current.path, Button.hard];
    }
    for (const action of [Button.left, Button.right, Button.cw, Button.ccw]) {
      const candidate =
        action === Button.left || action === Button.right
          ? { ...current.piece, x: current.piece.x + (action === Button.left ? -1 : 1) }
          : rotate(player.board, current.piece, action === Button.cw ? 1 : -1)?.active;
      if (candidate && !collides(player.board, candidate))
        queue.push({ piece: candidate, path: [...current.path, action] });
    }
  }
  return path;
}

export class RuleAi {
  private cooldown = 0;
  private digging = false;
  constructor(public level: AiLevel = 3) {}

  input(player: Player): Input {
    if (this.cooldown > 0) {
      this.cooldown--;
      if (this.cooldown > 0) return NO_INPUT;
    }
    if (!player.active || player.dead) return NO_INPUT;
    // Carry fractional ticks forward so level 7 alternates 2- and 1-tick gaps.
    this.cooldown += AI_INTERVALS[this.level - 1];
    const height = stackHeight(player.board);
    if (height >= 10) this.digging = true;
    else if (height <= 6) this.digging = false;
    // Re-plan from the actual position, including gravity and any SRS kicks.
    return { held: 0, pressed: planAi(player, this.digging)[0] ?? 0 };
  }
}
