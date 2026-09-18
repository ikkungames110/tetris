import { expect, test } from 'vitest';
import { AI_INTERVALS, planAi, RuleAi, type AiLevel } from '../../packages/core/ai';
import {
  createMatch,
  createPlayer,
  stateHash,
  stepMatch,
  stepPlayer,
} from '../../packages/core/engine';
import { NO_INPUT, RULES } from '../../packages/core/types';
import { newReplay, recordTick, ReplayPlayer } from '../../packages/core/replay';

test('AI clears lines with legal inputs and its match can be replayed exactly', () => {
  const match = createMatch('versus', 1234);
  const replay = newReplay('versus', 1234);
  const ai = new RuleAi(5);
  for (let tick = 0; tick < 6000 && !['finished', 'roundOver'].includes(match.phase); tick++) {
    const inputs: [typeof NO_INPUT, typeof NO_INPUT] = [
      NO_INPUT,
      match.phase === 'playing' ? ai.input(match.players[1]) : NO_INPUT,
    ];
    recordTick(replay, inputs);
    stepMatch(match, inputs);
  }
  expect(match.players[1].stats.lines).toBeGreaterThan(10);
  expect(match.players[1].stats.sent).toBeGreaterThan(0);
  replay.finalHash = stateHash(match);
  const playback = new ReplayPlayer(replay);
  while (!playback.done) playback.step();
  expect(playback.valid).toBe(true);
});

test('levels choose the same placements and differ only in input intervals', () => {
  const counts: number[] = [];
  for (let level = 1; level <= 5; level++) {
    const ai = new RuleAi(level as AiLevel);
    const player = createPlayer(42, 42);
    const before = structuredClone(player);
    expect(ai.input(player).pressed).toBe(planAi(player)[0]);
    expect(player).toEqual(before);
    for (let t = 1; t < AI_INTERVALS[level - 1]; t++) expect(ai.input(player)).toEqual(NO_INPUT);
    const runner = new RuleAi(level as AiLevel);
    for (let tick = 0; tick < 600; tick++)
      stepPlayer(player, runner.input(player), tick, { ...RULES, gravity: 100000 });
    counts.push(player.stats.pieces);
  }
  expect(counts.every((count, i) => i === 0 || count > counts[i - 1])).toBe(true);
});
