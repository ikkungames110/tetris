import { expect, it } from 'vitest';
import { GarbageRise, GARBAGE_RISE_MS } from '../../apps/web/garbage-rise';
import { createMatch, stepMatch } from '../../packages/core/engine';
import { Button, NO_INPUT } from '../../packages/core/types';
import { HIDDEN } from '../../packages/core/pieces';

it('publishes the raised terminal board before the defeat and preserves the received garbage', () => {
  const match = createMatch('versus', 42);
  match.phase = 'playing';
  const player = match.players[0];
  // Garbage lifts this stack into the spawn area; the next spawn loses.
  for (let y = 6; y < 20; y++) player.board[y + HIDDEN][4] = 'G';
  player.incoming = [{ id: 1, eligibleTick: 0, lines: 8 }];
  stepMatch(match, [{ held: 0, pressed: Button.hard }, NO_INPUT]);
  expect(player.stats.received).toBe(8);
  expect(
    player.board.slice(-8).every((row) => row.filter((cell) => cell === 'G').length === 9),
  ).toBe(true);
  expect(player.board[HIDDEN - 2][4]).toBe('G');
  stepMatch(match);
  expect(match.phase).toBe('roundOver');
  expect(match.winner).toBe(1);
  expect(player.dead).toBe(true);
  expect(player.stats.received).toBe(8);
});

it('animates newly received rows to their final height and resets between rounds', () => {
  const rise = new GarbageRise();
  expect(rise.offset(0, 100)).toBe(0);
  expect(rise.offset(8, 200)).toBe(8);
  expect(rise.offset(8, 200 + GARBAGE_RISE_MS / 2)).toBe(1);
  expect(rise.offset(8, 200 + GARBAGE_RISE_MS)).toBe(0);
  expect(rise.offset(10, 1000)).toBe(2);
  rise.reset();
  expect(rise.offset(0, 1100)).toBe(0);
  expect(rise.offset(8, 1200, true)).toBe(0);
});
