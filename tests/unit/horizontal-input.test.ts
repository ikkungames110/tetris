import { describe, expect, it } from 'vitest';
import { createMatch, createPlayer, stepMatch, stepPlayer } from '../../packages/core/engine';
import { Button, NO_INPUT, RULES } from '../../packages/core/types';
import { cells } from '../../packages/core/pieces';

// 100 Hz lets the requested 40/60 ms boundary be tested exactly.
const rules = { ...RULES, tickRate: 100, das: 10, arr: 0, countdown: 31 };
const left = { held: Button.left, pressed: 0 };
const both = Button.left | Button.right;
const atLeftWall = (p: ReturnType<typeof createPlayer>) =>
  Math.min(...cells(p.active!).map(([x]) => x)) === 0;

describe('DAS cancellation and countdown charging (DAS 100 ms, ARR 0)', () => {
  it('uses a 300 ms precharge on the exact tick that countdown ends', () => {
    const match = createMatch('sprint', 17, rules);
    stepMatch(match, [{ ...left, pressed: Button.left }], rules);
    for (let i = 0; i < 29; i++) stepMatch(match, [left], rules);
    expect(match.phase).toBe('countdown');
    expect(match.players[0].active!.x).toBe(3);
    stepMatch(match, [left], rules);
    expect(match.phase).toBe('playing');
    expect(match.players[0].dasTimer).toBe(30);
    expect(atLeftWall(match.players[0])).toBe(true);
  });

  it('preserves 40 ms and waits only the remaining 60 ms without an initial step', () => {
    const match = createMatch('sprint', 17, { ...rules, countdown: 5 });
    stepMatch(match, [{ ...left, pressed: Button.left }], rules);
    for (let i = 0; i < 4; i++) stepMatch(match, [left], rules);
    expect(match.players[0].dasTimer).toBe(4);
    expect(match.players[0].active!.x).toBe(3);
    for (let i = 0; i < 5; i++) stepMatch(match, [left], rules);
    expect(match.players[0].active!.x).toBe(3);
    stepMatch(match, [left], rules);
    expect(atLeftWall(match.players[0])).toBe(true);
  });

  it('moves once on RIGHT keydown, cancels LEFT charge, and recharges on RIGHT release', () => {
    const p = createPlayer(17, 2);
    stepPlayer(p, { ...left, pressed: Button.left }, 0, rules);
    for (let i = 1; i <= 10; i++) stepPlayer(p, left, i, rules);
    expect(atLeftWall(p)).toBe(true);
    const x = p.active!.x;
    stepPlayer(p, { held: both, pressed: Button.right }, 11, rules);
    expect(p.active!.x).toBe(x + 1);
    expect(p).toMatchObject({
      leftHeld: true,
      rightHeld: true,
      activeHorizontalDirection: 'right',
      dasTimer: 0,
      arrTimer: 0,
    });
    stepPlayer(p, { held: both, pressed: 0 }, 12, rules);
    expect(p.active!.x).toBe(x + 1);
    stepPlayer(p, left, 13, rules);
    expect(p).toMatchObject({ activeHorizontalDirection: 'left', dasTimer: 0, arrTimer: 0 });
    expect(p.active!.x).toBe(x + 1);
    for (let i = 1; i < 10; i++) stepPlayer(p, left, 13 + i, rules);
    expect(p.active!.x).toBe(x + 1);
    stepPlayer(p, left, 23, rules);
    expect(atLeftWall(p)).toBe(true);
    stepPlayer(p, NO_INPUT, 24, rules);
    expect(p).toMatchObject({
      leftHeld: false,
      rightHeld: false,
      activeHorizontalDirection: 'none',
      dasTimer: 0,
      arrTimer: 0,
    });
  });

  it.each([-1, 1] as const)('preserves press order within one simulation tick: %s', (last) => {
    const p = createPlayer(17, 2);
    stepPlayer(p, { held: both, pressed: both, lastHorizontalDirection: last }, 0, rules);
    expect(p.active!.x).toBe(3 + last);
    stepPlayer(p, { held: both, pressed: 0 }, 1, rules);
    expect(p.active!.x).toBe(3 + last);
  });

  it('cancels countdown charge on a direction change and clears it on release', () => {
    const match = createMatch('sprint', 17, rules);
    stepMatch(match, [{ ...left, pressed: Button.left }], rules);
    for (let i = 0; i < 12; i++) stepMatch(match, [left], rules);
    stepMatch(match, [{ held: both, pressed: Button.right }], rules);
    expect(match.players[0]).toMatchObject({ activeHorizontalDirection: 'right', dasTimer: 0 });
    stepMatch(match, [left], rules);
    expect(match.players[0]).toMatchObject({ activeHorizontalDirection: 'left', dasTimer: 0 });
    stepMatch(match, [NO_INPUT], rules);
    expect(match.players[0]).toMatchObject({ activeHorizontalDirection: 'none', dasTimer: 0 });
  });
});

it('supports DAS 100 ms at the production 60 Hz tick rate', () => {
  const match = createMatch('sprint', 17, { ...RULES, countdown: 19 });
  const sixtyHz = { ...RULES, das: 6, arr: 0 };
  stepMatch(match, [{ ...left, pressed: Button.left }], sixtyHz);
  for (let i = 0; i < 18; i++) stepMatch(match, [left], sixtyHz);
  expect(match.phase).toBe('playing');
  expect(atLeftWall(match.players[0])).toBe(true);
});

it('clears a partially elapsed ARR when switching directions', () => {
  const p = createPlayer(17, 2);
  const delayed = { ...rules, arr: 3 };
  stepPlayer(p, { ...left, pressed: Button.left }, 0, delayed);
  for (let i = 1; i <= 11; i++) stepPlayer(p, left, i, delayed);
  expect(p.arrTimer).toBe(1);
  stepPlayer(p, { held: both, pressed: Button.right }, 12, delayed);
  expect(p).toMatchObject({ dasTimer: 0, arrTimer: 0 });
  const x = p.active!.x;
  for (let i = 1; i < 10; i++) stepPlayer(p, { held: both, pressed: 0 }, 12 + i, delayed);
  expect(p.active!.x).toBe(x);
  stepPlayer(p, { held: both, pressed: 0 }, 22, delayed);
  expect(p.active!.x).toBe(x + 1);
});
