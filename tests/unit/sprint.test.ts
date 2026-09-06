import { describe, expect, it } from 'vitest';
import { createMatch, stepMatch, stateHash } from '../../packages/core/engine';
import { newReplay, parseReplay, recordTick, ReplayPlayer } from '../../packages/core/replay';
import { Button, NO_INPUT, RULES, type Match } from '../../packages/core/types';
import { HoldReset } from '../../apps/web/hold-reset';
import { timeLabel } from '../../apps/web/render';

function fourLines(match: Match): void {
  const player = match.players[0];
  for (let y = 36; y < 40; y++)
    player.board[y] = Array.from({ length: 10 }, (_, x) => (x === 4 ? null : 'G'));
  player.active = { type: 'I', x: 2, y: 16, rotation: 1 };
  stepMatch(match, [{ held: Button.hard, pressed: Button.hard }, NO_INPUT]);
}

describe('40LINE', () => {
  it('starts timing after countdown and only advances the local player', () => {
    const match = createMatch('sprint', 42);
    const opponent = structuredClone(match.players[1]);
    for (let i = 0; i < RULES.countdown; i++) stepMatch(match);
    expect(match.phase).toBe('playing');
    expect(match.roundTicks).toBe(0);
    stepMatch(match, [NO_INPUT, { held: Button.hard, pressed: Button.hard }]);
    expect(match.roundTicks).toBe(1);
    expect(match.players[1]).toEqual(opponent);
  });

  it.each([36, 37, 39])('stops on the exact clearing tick when starting from %i lines', (lines) => {
    const match = createMatch('sprint', 42);
    match.phase = 'playing';
    match.roundTicks = 1234;
    match.players[0].stats.lines = lines;
    fourLines(match);
    expect(match.players[0].stats.lines).toBe(lines + 4);
    expect(match.phase).toBe('finished');
    expect(match.winner).toBe(0);
    expect(match.roundTicks).toBe(1235);
    expect(match.events.at(-1)?.type).toBe('roundEnd');
    const player = structuredClone(match.players[0]);
    for (let i = 0; i < 120; i++) stepMatch(match);
    expect(match.roundTicks).toBe(1235);
    expect(match.players[0]).toEqual(player);
  });

  it('continues below 40 and endless continues beyond 40', () => {
    for (const mode of ['sprint', 'practice'] as const) {
      const match = createMatch(mode, 42);
      match.phase = 'playing';
      match.players[0].stats.lines = mode === 'sprint' ? 35 : 39;
      fourLines(match);
      expect(match.phase).toBe('playing');
      expect(match.winner).toBeNull();
    }
  });

  it('ends a top-out before 40 as a failure without a time limit', () => {
    const match = createMatch('sprint', 42);
    match.phase = 'playing';
    match.roundTicks = RULES.roundLimit;
    stepMatch(match);
    expect(match.phase).toBe('playing');
    match.players[0].dead = true;
    stepMatch(match);
    expect(match.phase).toBe('finished');
    expect(match.winner).toBeNull();
  });

  it('saves and validates sprint replays', () => {
    const match = createMatch('sprint', 17);
    const replay = newReplay('sprint', 17);
    for (let i = 0; i < 240; i++) {
      const inputs = [NO_INPUT, NO_INPUT] as [typeof NO_INPUT, typeof NO_INPUT];
      recordTick(replay, inputs);
      stepMatch(match, inputs);
    }
    replay.finalHash = stateHash(match);
    const playback = new ReplayPlayer(parseReplay(JSON.stringify(replay)));
    while (!playback.done) playback.step();
    expect(playback.valid).toBe(true);
    expect(playback.match.roundTicks).toBe(60);
  });

  it('formats millisecond precision without rounding up to the next second', () => {
    expect(timeLabel(0, true)).toBe('00:00.000');
    expect(timeLabel(1, true)).toBe('00:00.016');
    expect(timeLabel(3599, true)).toBe('00:59.983');
    expect(timeLabel(3600, true)).toBe('01:00.000');
    expect(timeLabel(3601)).toBe('01:00');
  });
});

describe('B8 hold to reset', () => {
  it('ignores short taps and fires once after a continuous second until released', () => {
    const hold = new HoldReset();
    expect(hold.update(true, true, 0)).toBe(false);
    expect(hold.update(true, true, 999)).toBe(false);
    expect(hold.update(false, true, 999)).toBe(false);
    expect(hold.update(true, true, 1000)).toBe(false);
    expect(hold.update(true, true, 1999)).toBe(false);
    expect(hold.update(true, true, 2000)).toBe(true);
    expect(hold.update(true, true, 9000)).toBe(false);
    hold.update(false, true, 9001);
    hold.update(true, true, 9002);
    expect(hold.update(true, true, 10002)).toBe(true);
  });

  it('requires release after disabled contexts or explicit cancellation', () => {
    const hold = new HoldReset();
    hold.update(true, true, 0);
    expect(hold.update(true, false, 500)).toBe(false);
    expect(hold.update(true, true, 1500)).toBe(false);
    hold.update(false, true, 1501);
    hold.update(true, true, 1502);
    hold.cancel();
    expect(hold.update(true, true, 2502)).toBe(false);
    hold.update(false, true, 2503);
    hold.update(true, true, 2504);
    expect(hold.update(true, true, 3504)).toBe(true);
  });
});

it('reaches 40 from an empty board and validates the complete recorded run', async () => {
  const { default: fixture } = await import('../fixtures/sprint-clear.json');
  const match = createMatch('sprint', fixture.seed);
  const replay = newReplay('sprint', fixture.seed);
  const buttons: Record<string, number> = {
    '.': 0,
    L: Button.left,
    R: Button.right,
    X: Button.cw,
    H: Button.hard,
  };
  for (const key of '.'.repeat(RULES.countdown) + fixture.placements.join('')) {
    expect(match.phase).not.toBe('finished');
    const inputs = [{ held: 0, pressed: buttons[key] }, NO_INPUT] as [
      typeof NO_INPUT,
      typeof NO_INPUT,
    ];
    recordTick(replay, inputs);
    stepMatch(match, inputs);
  }
  expect(match.players[0].stats.lines).toBe(40);
  expect(match.phase).toBe('finished');
  expect(match.winner).toBe(0);
  expect(match.roundTicks).toBe(fixture.roundTicks);
  expect(stateHash(match)).toBe(fixture.finalHash);
  replay.finalHash = stateHash(match);
  const playback = new ReplayPlayer(parseReplay(JSON.stringify(replay)));
  while (!playback.done) playback.step();
  expect(playback.valid).toBe(true);
});
