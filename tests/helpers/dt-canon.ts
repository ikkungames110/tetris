import dtCanon from '../../src/templete/DT canon/DT_canon1.json' with { type: 'json' };
import { createMatch } from '../../packages/core/engine';
import { cells, HIDDEN } from '../../packages/core/pieces';
import type { ActivePiece, Player } from '../../packages/core/types';

export function dtDouble(x = 0, y = 13, mirror = false): ActivePiece {
  return { type: 'T', x: x + 1, y: y + 3, rotation: mirror ? 1 : 3 };
}
export function dtTriple(player: Player, x = 0, y = 13, mirror = false): void {
  // 消去行を検証するため、Tの固定座標を型の中の一点には限定しない。
  player.active = { type: 'T', x: x <= 2 ? 7 : 0, y: y + 4, rotation: mirror ? 1 : 3 };
  player.rotationKick = 0;
}
export function dtCanonMatch(x = 0, y = 13, mirror = false) {
  const match = createMatch('practice', 42);
  match.phase = 'playing';
  const player = match.players[0];
  for (let row = 13; row < 20; row++)
    for (let column = 0; column < 5; column++)
      if (dtCanon.cells[row][column])
        player.board[HIDDEN + y + row - 13][x + (mirror ? 4 - column : column)] = 'J';
  // 最初は下から2・3行目だけ、次はDT canon2の下3行だけが消える配置。
  for (let row = 2; row < 7; row++) player.board[HIDDEN + y + row].fill('L');
  dtTriple(player, x, y, mirror);
  for (const [tx, ty] of cells(player.active!)) {
    const beforeY = ty === y + 6 ? ty : ty - 2;
    player.board[HIDDEN + beforeY][tx] = null;
  }
  player.active = dtDouble(x, y, mirror);
  for (const [tx, ty] of cells(player.active)) player.board[HIDDEN + ty][tx] = null;
  player.rotationKick = 0;
  return match;
}
