import dtCanon from '../../src/templete/DT canon/DT canon_new.json' with { type: 'json' };
import { createMatch } from '../../packages/core/engine';
import { cells, HIDDEN } from '../../packages/core/pieces';
import type { ActivePiece, Player } from '../../packages/core/types';

export function dtDouble(x = 0, y = 13, _mirror = false): ActivePiece {
  // Doubleは左右対称の下向きT。反転しても同じ座標・向きになる。
  return { type: 'T', x: x + 1, y: y + 3, rotation: 2 };
}
export function dtTriple(player: Player, x = 0, y = 13, mirror = false): void {
  // 状態2の内部にTを入れ、実際の下3行を消す。
  player.active = { type: 'T', x: x + 1, y: y + 4, rotation: mirror ? 1 : 3 };
  player.rotationKick = 0;
}
export function dtCanonMatch(x = 0, y = 13, mirror = false) {
  const match = createMatch('practice', 42);
  match.phase = 'playing';
  const player = match.players[0];
  for (let row = 13; row < 20; row++)
    for (let column = 0; column < 5; column++)
      if (dtCanon.states[0].cells[row][column] === dtCanon.cellTypes.gray)
        player.board[HIDDEN + y + row - 13][x + (mirror ? 4 - column : column)] = 'J';
  // 最初は下から2・3行目だけ、次は状態2の下3行だけが消える配置。
  for (let row = 2; row < 7; row++) player.board[HIDDEN + y + row].fill('L');
  // 入口からDouble・Tripleの穴までを開ける。型の外側だけをライン完成用に埋める。
  for (const [dx, dy] of [
    [2, 2],
    [1, 3],
    [2, 3],
    [1, 4],
    [2, 4],
    [3, 4],
    [2, 5],
    [2, 6],
  ])
    player.board[HIDDEN + y + dy][x + (mirror ? 4 - dx : dx)] = null;
  player.active = dtDouble(x, y, mirror);
  for (const [tx, ty] of cells(player.active)) player.board[HIDDEN + ty][tx] = null;
  player.rotationKick = 0;
  return match;
}
