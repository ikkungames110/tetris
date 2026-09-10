import { createMatch } from '../../packages/core/engine';
import { cells, collides, HEIGHT, HIDDEN, rotate, WIDTH } from '../../packages/core/pieces';
import { templateDefinitions } from '../../packages/core/templates';
import type { ActivePiece, Player } from '../../packages/core/types';

// 消去行とTの座標はJSONから自動計算せず、各連携の期待値として記す。
export const templateCases = [
  {
    id: 'double-dagger',
    name: 'Double dagger',
    left: 2,
    width: 5,
    padding: [
      [2, 19],
      [6, 19],
    ],
    rows: [
      [16, 17],
      [18, 19],
    ],
    pieces: [
      { type: 'T', x: 3, y: 15, rotation: 2 },
      { type: 'T', x: 3, y: 17, rotation: 2 },
    ],
  },
  {
    id: 'houndstooth',
    name: 'Houndstooth',
    left: 1,
    width: 6,
    padding: [
      [1, 19],
      [6, 19],
    ],
    rows: [
      [17, 18],
      [18, 19],
    ],
    pieces: [
      { type: 'T', x: 3, y: 16, rotation: 2 },
      { type: 'T', x: 2, y: 17, rotation: 2 },
    ],
  },
  {
    id: 'imperial-cross',
    name: 'Imperial cross',
    left: 0,
    width: 5,
    padding: [[4, 16]],
    rows: [
      [17, 19],
      [18, 19],
    ],
    pieces: [
      { type: 'T', x: 1, y: 17, rotation: 1 },
      { type: 'T', x: 0, y: 17, rotation: 2 },
    ],
  },
  {
    id: 'stsd',
    name: 'STSD',
    left: 0,
    width: 4,
    padding: [],
    rows: [
      [17, 18],
      [18, 19],
    ],
    pieces: [
      { type: 'T', x: 1, y: 17, rotation: 3 },
      { type: 'T', x: 0, y: 17, rotation: 2 },
    ],
  },
  {
    id: 'td-attack',
    name: 'TD attack',
    left: 2,
    width: 4,
    padding: [],
    rows: [
      [16, 17, 18],
      [18, 19],
    ],
    pieces: [
      { type: 'T', x: 3, y: 16, rotation: 3 },
      { type: 'T', x: 2, y: 17, rotation: 2 },
    ],
  },
] as const;
export type TemplateCase = (typeof templateCases)[number];

export function prepareTemplatePiece(
  player: Player,
  example: TemplateCase,
  step: number,
  x: number = example.left,
  dy = 0,
  mirror = false,
): void {
  const source = example.pieces[step];
  const rotation = mirror && source.rotation % 2 ? 4 - source.rotation : source.rotation;
  player.active = {
    ...source,
    x: x + (mirror ? example.width - 3 - (source.x - example.left) : source.x - example.left),
    y: source.y + dy,
    rotation: rotation as ActivePiece['rotation'],
  };
  // STSD初段は前側の角が1つ空くため、SRSの5番目のキックでFullになる。
  player.rotationKick = 1;
  if (example.id === 'stsd' && step === 0) {
    const before: ActivePiece = {
      ...player.active,
      x: player.active.x + (mirror ? 1 : -1),
      y: player.active.y - 2,
      rotation: 0,
    };
    const rotated = rotate(player.board, before, mirror ? 1 : -1);
    if (
      collides(player.board, before) ||
      !rotated ||
      rotated.kick !== 5 ||
      JSON.stringify(rotated.active) !== JSON.stringify(player.active)
    )
      throw new Error('STSD test must use a valid fifth SRS kick');
    player.rotationKick = rotated.kick;
  }
}

export function templateMatch(
  example: TemplateCase,
  x: number = example.left,
  dy = 0,
  mirror = false,
  initialStep = 0,
) {
  const match = createMatch('practice', 42);
  match.phase = 'playing';
  const player = match.players[0];
  const definition = templateDefinitions.find((t) => t.id === example.id)!;
  const state = definition.states[initialStep];
  const mx = (column: number) =>
    x + (mirror ? example.width - 1 - (column - example.left) : column - example.left);
  state.cells.forEach((row, y) => {
    if (row.every((value) => value === definition.cellTypes.empty)) return;
    for (let column = 0; column < WIDTH; column++)
      if (column < x || column >= x + example.width) player.board[HIDDEN + y + dy][column] = 'L';
    row.forEach((value, column) => {
      if (value === definition.cellTypes.gray) player.board[HIDDEN + y + dy][mx(column)] = 'J';
    });
    if (example.rows[initialStep].some((clearRow) => clearRow === y))
      for (const column of [example.left, example.left + example.width - 1])
        if (row[column] === definition.cellTypes.empty)
          player.board[HIDDEN + y + dy][mx(column)] = 'L';
  });
  // 初段では消さない行の端も、次のDoubleが完成するように積み足す。
  if (initialStep === 0)
    for (const [column, y] of example.padding) player.board[HIDDEN + y + dy][mx(column)] = 'L';
  // 高い位置の例でも最終Doubleの下側の角と接地を用意する。
  if (dy < 0) {
    prepareTemplatePiece(player, example, 1, x, dy, mirror);
    for (const column of [player.active!.x, player.active!.x + 2])
      player.board[HIDDEN + HEIGHT + dy][column] = 'G';
  }
  prepareTemplatePiece(player, example, initialStep, x, dy, mirror);
  if (cells(player.active!).some(([tx, ty]) => player.board[HIDDEN + ty][tx] !== null))
    throw new Error(`Occupied test T placement: ${example.id}`);
  return match;
}
