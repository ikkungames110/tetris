import { cells, collides, HEIGHT, HIDDEN, landing, rotate, shape, WIDTH } from './pieces';
import {
  Button,
  NO_INPUT,
  PIECES,
  type ActivePiece,
  type Cell,
  type Input,
  type Piece,
  type Player,
  type Rotation,
} from './types';

export const AI_INTERVALS = [30, 18, 10, 6, 3, 2, 1.5, 1] as const;
export type AiLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const BEAM_WIDTH = 8;
const LOOKAHEAD = 2;

function stackHeight(board: Cell[][]): number {
  const top = board.findIndex((row) => row.some((cell) => cell !== null));
  return top < 0 ? 0 : board.length - top;
}

function boardKey(board: Cell[][]): string {
  return board.map((row) => row.map((cell) => (cell === null ? '0' : '1')).join('')).join('');
}

function terrain(board: Cell[][], digging: boolean, next: readonly Piece[]) {
  const heights = Array<number>(WIDTH).fill(0);
  let holes = 0;
  let coveredBlocks = 0;
  for (let x = 0; x < WIDTH; x++) {
    let blocks = 0;
    let cover = 0;
    for (let y = 0; y < board.length; y++) {
      if (board[y][x] !== null) {
        heights[x] ||= board.length - y;
        blocks++;
      } else if (blocks) {
        holes++;
        cover = blocks;
      }
    }
    coveredBlocks += cover;
  }
  const height = Math.max(...heights);
  let roughness = 0;
  let trenches = 0;
  let deepWells = 0;
  for (let x = 0; x < WIDTH; x++) {
    if (x > 0) roughness += Math.abs(heights[x] - heights[x - 1]);
    const depth = Math.min(heights[x - 1] ?? height, heights[x + 1] ?? height) - heights[x];
    if (depth >= 3) deepWells++;
    // A single four-high edge well is useful; deeper/multiple wells require too many I pieces.
    const allowance = !digging && (x === 0 || x === WIDTH - 1) && next.includes('I') ? 4 : 2;
    trenches += Math.max(0, depth - allowance) ** 2;
    if (x < WIDTH - 1) {
      const wideDepth =
        Math.min(heights[x - 1] ?? height, heights[x + 2] ?? height) -
        Math.max(heights[x], heights[x + 1]);
      trenches += Math.max(0, wideDepth - 2) ** 2;
    }
  }
  return {
    holes,
    score:
      -holes * 55 -
      coveredBlocks * 4 -
      heights.reduce((a, b) => a + b, 0) * (digging ? 1 : 0.65) -
      height * (digging ? 4 : 2) -
      Math.max(0, height - 8) ** 2 * 2 -
      roughness * 0.9 -
      trenches * 3 -
      Math.max(0, deepWells - 1) * 18,
  };
}

function moved(board: Cell[][], piece: ActivePiece, action: number): ActivePiece | null {
  if (action === Button.left || action === Button.right) {
    const candidate = { ...piece, x: piece.x + (action === Button.left ? -1 : 1) };
    return collides(board, candidate) ? null : candidate;
  }
  return rotate(board, piece, action === Button.cw ? 1 : -1)?.active ?? null;
}

type Placement = { piece: ActivePiece; path: number[] };
function placements(board: Cell[][], active: ActivePiece): Placement[] {
  if (collides(board, active)) return [];
  const queue: Placement[] = [{ piece: active, path: [] }];
  const seen = new Set<string>();
  const landed = new Set<string>();
  const result: Placement[] = [];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const key = `${current.piece.x}:${current.piece.y}:${current.piece.rotation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const piece = landing(board, current.piece);
    const fixedKey = cells(piece)
      .map(([x, y]) => y * WIDTH + x)
      .sort((a, b) => a - b)
      .join(',');
    if (!landed.has(fixedKey)) {
      landed.add(fixedKey);
      result.push({ piece, path: [...current.path, Button.hard] });
    }
    for (const action of [Button.left, Button.right, Button.cw, Button.ccw]) {
      const candidate = moved(board, current.piece, action);
      if (candidate) queue.push({ piece: candidate, path: [...current.path, action] });
    }
  }
  return result;
}

// Below the spawn area, all horizontal/rotation choices are reachable in open
// air. Enumerate unique shapes directly for NEXT pieces instead of repeating BFS.
const shapes = new Map(
  PIECES.map((type) => {
    const seen = new Set<string>();
    const variants = ([0, 1, 2, 3] as Rotation[]).flatMap((rotation) => {
      const points = shape(type, rotation);
      const minX = Math.min(...points.map(([x]) => x));
      const minY = Math.min(...points.map(([, y]) => y));
      const key = points
        .map(([x, y]) => `${x - minX}:${y - minY}`)
        .sort()
        .join(',');
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ rotation, points, minX, maxX: Math.max(...points.map(([x]) => x)) }];
    });
    return [type, variants] as const;
  }),
);

function futurePlacements(board: Cell[][], active: ActivePiece): Placement[] {
  if (stackHeight(board) >= 18) return placements(board, active);
  const surface = Array.from({ length: WIDTH }, (_, x) => {
    const top = board.findIndex((row) => row[x] !== null);
    return top < 0 ? HEIGHT : top - HIDDEN;
  });
  const result: Placement[] = [];
  for (const variant of shapes.get(active.type)!) {
    for (let x = -variant.minX; x < WIDTH - variant.maxX; x++) {
      const y = Math.min(...variant.points.map(([dx, dy]) => surface[x + dx] - dy - 1));
      result.push({ piece: { type: active.type, x, y, rotation: variant.rotation }, path: [] });
    }
  }
  return result;
}

function place(board: Cell[][], piece: ActivePiece) {
  const fixed = cells(piece);
  const copy = board.map((row) => [...row]);
  for (const [x, y] of fixed) copy[y + HIDDEN][x] = piece.type;
  const cleared: number[] = [];
  const remaining = copy.filter((row, y) => {
    if (row.some((cell) => cell === null)) return true;
    cleared.push(y);
    return false;
  });
  // Match the engine's post-clear lock-out rule, including rescues by line clears.
  if (
    fixed.every(
      ([, y]) =>
        !cleared.includes(y + HIDDEN) && y + cleared.filter((row) => row > y + HIDDEN).length < 0,
    )
  )
    return null;
  return {
    board: [
      ...Array.from({ length: cleared.length }, () => Array<Cell>(WIDTH).fill(null)),
      ...remaining,
    ],
    lines: cleared.length,
  };
}

type SearchNode = {
  board: Cell[][];
  path: number[];
  reward: number;
  score: number;
  holes: number;
  digging: boolean;
};

// All levels search the current piece plus two visible NEXT pieces. Pruning bounds
// browser work; only legal move paths are considered, never unseen bag contents.
export function planAi(player: Player, digging = stackHeight(player.board) >= 10): number[] {
  if (!player.active || player.dead) return [];
  let beam: SearchNode[] = [
    {
      board: player.board,
      path: [],
      reward: 0,
      score: 0,
      holes: terrain(player.board, digging, player.next).holes,
      digging,
    },
  ];
  const types = [player.active.type, ...player.next.slice(0, LOOKAHEAD)];
  for (let depth = 0; depth < types.length; depth++) {
    const candidates: SearchNode[] = [];
    for (const node of beam) {
      let active: ActivePiece =
        depth === 0 ? player.active : { type: types[depth], x: 3, y: -2, rotation: 0 };
      if (collides(node.board, active)) continue;
      if (depth > 0 && !collides(node.board, { ...active, y: -1 })) active = { ...active, y: -1 };
      for (const placement of (depth === 0 ? placements : futurePlacements)(node.board, active)) {
        const placed = place(node.board, placement.piece);
        if (!placed) continue;
        const height = stackHeight(placed.board);
        const nextDigging = height >= 10 || (node.digging && height > 6);
        const metrics = terrain(placed.board, nextDigging, player.next.slice(depth));
        const clearReward = (node.digging ? [0, 40, 85, 135, 220] : [0, -8, 16, 48, 150])[
          placed.lines
        ];
        // Charge for NEW holes along the path as well as those left at the horizon.
        const reward =
          node.reward + clearReward * 0.85 ** depth - Math.max(0, metrics.holes - node.holes) * 20;
        candidates.push({
          board: placed.board,
          path: depth === 0 ? placement.path : node.path,
          reward,
          score: reward + metrics.score,
          holes: metrics.holes,
          digging: nextDigging,
        });
      }
    }
    if (!candidates.length) break;
    candidates.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    beam = [];
    for (const candidate of candidates) {
      const key = boardKey(candidate.board);
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(candidate);
      if (beam.length === BEAM_WIDTH) break;
    }
  }
  return beam[0]?.path.length ? beam[0].path : [Button.hard];
}

export class RuleAi {
  private cooldown = 0;
  private digging = false;
  private path: number[] = [];
  private expected: ActivePiece | null = null;
  private context = '';
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
    const context = `${player.stats.pieces}:${boardKey(player.board)}:${player.next.join('')}:${this.digging}`;
    const active = player.active;
    if (
      !this.path.length ||
      context !== this.context ||
      !this.expected ||
      active.type !== this.expected.type ||
      active.x !== this.expected.x ||
      active.y !== this.expected.y ||
      active.rotation !== this.expected.rotation
    ) {
      this.path = planAi(player, this.digging);
      this.context = context;
    }
    const action = this.path.shift() ?? Button.hard;
    this.expected = action === Button.hard ? null : moved(player.board, active, action);
    return { held: 0, pressed: action };
  }
}
