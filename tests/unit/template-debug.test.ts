import { expect, it } from 'vitest';
import pattern from '../../src/templete/DT canon/DT canon.json' with { type: 'json' };
import { emptyBoard } from '../../packages/core/engine';
import { boardMasks, detectTemplateShapes } from '../../packages/core/templates';
import { TemplateDebug } from '../../apps/web/template-debug';

function rawShape(x = 0, y = 13, mirror = false) {
  const board = emptyBoard();
  for (let row = 13; row < 20; row++)
    for (let column = 0; column < 5; column++)
      if (pattern.cells[row][column])
        board[20 + y + row - 13][x + (mirror ? 4 - column : column)] = 'J';
  return board;
}

it('detects the supplied JSON before any T-spin or line clear, including translated and mirrored shapes', () => {
  for (const mirror of [false, true])
    for (const [x, y] of [
      [0, 13],
      [2, 7],
      [5, 0],
    ]) {
      const board = rawShape(x, y, mirror);
      const before = structuredClone(board);
      expect(detectTemplateShapes(boardMasks(board))).toContainEqual({
        id: 'dt-canon',
        variant: mirror ? 1 : 0,
        x,
        y: 20 + y,
      });
      expect(board).toEqual(before);
    }
});

it('requires fixed support blocks and open T spaces while allowing blocks outside the pattern', () => {
  const board = rawShape();
  board[39][9] = 'O';
  expect(detectTemplateShapes(boardMasks(board))).toHaveLength(1);
  board[39][1] = null;
  expect(detectTemplateShapes(boardMasks(board))).toEqual([]);
  board[39][1] = 'G';
  board[34][1] = 'T';
  expect(detectTemplateShapes(boardMasks(board))).toEqual([]);
});

it('keeps the last detection after firing, ignores duplicate snapshots, and resets for a new game', () => {
  const debug = new TemplateDebug();
  const board = rawShape();
  debug.update(board, 0);
  expect(debug.message).toBe('DT canon 検知（1P・左1列目・上14行目）');
  debug.update(rawShape(5, 2, true), 1);
  const last = debug.message;
  expect(last).toContain('2P・左6列目・上3行目・左右反転');
  debug.update(structuredClone(board), 0);
  expect(debug.message).toBe(last);
  debug.update(emptyBoard(), 0);
  expect(debug.message).toBe(last);
  debug.update(board, 0);
  expect(debug.message).toContain('1P');
  debug.reset();
  expect(debug.message).toBe('未検知');
  debug.update(board, 0);
  expect(debug.message).toContain('DT canon 検知');
});
