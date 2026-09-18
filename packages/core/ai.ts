import { cells, collides, HIDDEN, landing, rotate, WIDTH } from './pieces';
import { Button, NO_INPUT, type ActivePiece, type Cell, type Input, type Player } from './types';

export const AI_INTERVALS = [30, 18, 10, 6, 3] as const;
export type AiLevel = 1 | 2 | 3 | 4 | 5;

// Every level uses the same evaluation and legal move search.
function evaluate(board: Cell[][], piece: ActivePiece): number {
  const fixed = cells(landing(board, piece));
  const copy = board.map((row) => [...row]);
  for (const [x, y] of fixed) copy[y + HIDDEN][x] = piece.type;
  const remaining = copy.filter((row) => row.some((cell) => cell === null));
  const lines = copy.length - remaining.length;
  const heights = Array<number>(WIDTH).fill(0);
  let holes = 0;
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < remaining.length; y++) {
      if (remaining[y][x] !== null) heights[x] ||= remaining.length - y;
      else if (heights[x]) holes++;
    }
  }
  const bumpiness = heights
    .slice(1)
    .reduce((sum, height, i) => sum + Math.abs(height - heights[i]), 0);
  // Saving a clean well is worthwhile while the stack is low. Near the top,
  // survival takes precedence over waiting for a larger clear.
  const danger = Math.max(...heights) >= 12;
  const clearReward = (danger ? [0, 8, 28, 60, 110] : [0, -8, 16, 48, 100])[lines];
  const well = Math.max(
    Math.min(4, Math.max(0, Math.min(...heights.slice(1)) - heights[0])),
    Math.min(4, Math.max(0, Math.min(...heights.slice(0, -1)) - heights[WIDTH - 1])),
  );
  return (
    clearReward +
    (danger ? 0 : well * 3) -
    holes * 12 -
    heights.reduce((a, b) => a + b, 0) * 0.6 -
    bumpiness * 0.8 -
    Math.max(...heights) * 1.5 -
    (fixed.every(([, y]) => y < 0) ? 10000 : 0)
  );
}

export function planAi(player: Player): number[] {
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
    const score = evaluate(player.board, current.piece);
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
  constructor(public level: AiLevel = 3) {}

  input(player: Player): Input {
    if (this.cooldown > 0) {
      this.cooldown--;
      return NO_INPUT;
    }
    if (!player.active || player.dead) return NO_INPUT;
    this.cooldown = AI_INTERVALS[this.level - 1] - 1;
    // Re-plan from the actual position, including gravity and any SRS kicks.
    return { held: 0, pressed: planAi(player)[0] ?? 0 };
  }
}
