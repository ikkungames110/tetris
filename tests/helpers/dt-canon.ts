import dtCanon from '../../src/templete/DT canon/DT canon.json' with { type: 'json' };
import { createMatch } from '../../packages/core/engine';
import { HIDDEN } from '../../packages/core/pieces';
import type { ActivePiece, Player } from '../../packages/core/types';

export function dtCanonMatch(x = 0, y = 13, mirror = false) {
  const match = createMatch('practice', 42);
  match.phase = 'playing';
  const player = match.players[0];
  const mx = (dx: number) => x + (mirror ? 4 - dx : dx);
  for (let row = 13; row < 20; row++)
    for (let column = 0; column < 5; column++)
      if (dtCanon.cells[row][column]) player.board[HIDDEN + y + row - 13][mx(column)] = 'J';
  // 型の周囲を埋め、二つのTミノが入る空間だけを残す。
  for (let row = 0; row < 5; row++) player.board[HIDDEN + y + row].fill('L');
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 3],
    [2, 3],
    [2, 4],
  ])
    player.board[HIDDEN + y + dy][mx(dx)] = null;
  player.active = dtDouble(x, y, mirror);
  player.rotationKick = 0;
  return match;
}

export function dtDouble(x = 0, y = 13, mirror = false): ActivePiece {
  return { type: 'T', x: x + (mirror ? 2 : 0), y, rotation: 0 };
}

export function dtTriple(player: Player, x = 0, y = 13, mirror = false): void {
  player.active = { type: 'T', x: x + 1, y: y + 2, rotation: mirror ? 1 : 3 };
  player.rotationKick = 0;
}
