import type { ActivePiece, Cell, Piece, Point, Rotation } from './types';

export const WIDTH = 10;
export const HEIGHT = 20;
export const HIDDEN = 20;
const INITIAL: Record<Piece, readonly Point[]> = {
  J: [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  L: [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  S: [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  Z: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
  T: [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  I: [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ],
  O: [
    [1, 0],
    [2, 0],
    [1, 1],
    [2, 1],
  ],
};

export function shape(type: Piece, rotation: Rotation = 0): Point[] {
  if (type === 'O') return [...INITIAL.O];
  const center = type === 'I' ? 1.5 : 1;
  return INITIAL[type].map(([initialX, initialY]) => {
    let x = initialX;
    let y = initialY;
    for (let i = 0; i < rotation; i++) [x, y] = [center - (y - center), center + (x - center)];
    return [x, y];
  });
}
export function cells(active: ActivePiece): Point[] {
  return shape(active.type, active.rotation).map(([x, y]) => [x + active.x, y + active.y]);
}
export function occupied(board: Cell[][], x: number, y: number): boolean {
  return x < 0 || x >= WIDTH || y < -HIDDEN || y >= HEIGHT || board[y + HIDDEN][x] !== null;
}
export function collides(board: Cell[][], active: ActivePiece): boolean {
  return cells(active).some(([x, y]) => occupied(board, x, y));
}
export function landing(board: Cell[][], active: ActivePiece): ActivePiece {
  const result = { ...active };
  while (!collides(board, { ...result, y: result.y + 1 })) result.y++;
  return result;
}

// SRS offsets use positive Y UP, unlike the board. Try offsets independently.
const NORMAL: Record<string, readonly Point[]> = {
  '0>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '1>0': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '1>2': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '2>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '2>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '3>2': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '3>0': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '0>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
};
const I_KICKS: Record<string, readonly Point[]> = {
  '0>1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '1>0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '1>2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  '2>1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '2>3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '3>2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '3>0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '0>3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
};

export function rotate(
  board: Cell[][],
  active: ActivePiece,
  direction: -1 | 1,
): { active: ActivePiece; kick: number } | null {
  if (active.type === 'O') return null;
  const rotation = ((active.rotation + direction + 4) % 4) as Rotation;
  const candidates = (active.type === 'I' ? I_KICKS : NORMAL)[`${active.rotation}>${rotation}`];
  for (let i = 0; i < candidates.length; i++) {
    const [dx, dy] = candidates[i];
    const candidate = { ...active, x: active.x + dx, y: active.y - dy, rotation };
    if (!collides(board, candidate)) return { active: candidate, kick: i + 1 };
  }
  return null;
}
