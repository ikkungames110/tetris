import { describe, expect, it } from 'vitest';
import { createMatch, stepMatch } from '../../packages/core/engine';
import { Button, NO_INPUT, RULES } from '../../packages/core/types';
import { PlayerPrediction } from '../../packages/network/prediction';
import { publicMatch } from '../../packages/protocol/online';

describe('local player prediction', () => {
  it('predicts handicapped attack totals consistently through unacknowledged input replay', () => {
    const match = createMatch('versus', 42);
    match.phase = 'playing';
    const player = match.players[1];
    for (let y = 36; y < 40; y++)
      player.board[y] = Array.from({ length: 10 }, (_, x) => (x === 4 ? null : 'G'));
    player.board[30][0] = 'J';
    player.active = { type: 'I', x: 2, y: 16, rotation: 1 };
    player.incoming = [{ id: 1, lines: 1, eligibleTick: 100 }];
    const prediction = new PlayerPrediction();
    const snapshot = publicMatch(match).players[1];
    prediction.reconcile(snapshot, 0, 0, 2);
    const drop = { held: 0, pressed: Button.hard };
    prediction.input(1, drop);
    expect(prediction.player!.stats).toMatchObject({ sent: 1, cancelled: 1 });
    prediction.reconcile(snapshot, 0, 0, 2);
    expect(prediction.player!.stats).toMatchObject({ sent: 1, cancelled: 1 });
    stepMatch(match, [NO_INPUT, drop], RULES, undefined, { seat: 1, lines: 2 });
    prediction.reconcile(publicMatch(match).players[1], match.tick, 1, 2);
    expect(prediction.player!.stats).toEqual(player.stats);
  });

  it('shows movement, rotation, hold and hard drop immediately, then reconciles without double execution', () => {
    const match = createMatch('versus', 42);
    match.phase = 'playing';
    const prediction = new PlayerPrediction();
    prediction.reconcile(publicMatch(match).players[1], match.tick, 0);
    const frames = [
      Button.left,
      Button.cw,
      Button.hold,
      Button.hard,
      0,
      Button.right,
      Button.hard,
    ].map((pressed) => ({ held: 0, pressed }));
    frames.forEach((input, i) => prediction.input(i + 1, input));
    expect(prediction.player!.stats.pieces).toBe(2);
    expect(match.players[1].stats.pieces).toBe(0);
    for (let i = 0; i < frames.length; i++) {
      stepMatch(match, [NO_INPUT, frames[i]]);
      prediction.reconcile(publicMatch(match).players[1], match.tick, i + 1);
      expect(prediction.player!.stats.pieces).toBe(2);
    }
    const { bag: _bag, garbageRng: _rng, ...predicted } = prediction.player!;
    expect(predicted).toEqual(publicMatch(match).players[1]);
    prediction.reset();
    expect(prediction.player).toBeNull();
  });

  it('stops at unknown garbage holes and corrects to the authoritative board', () => {
    const match = createMatch('versus', 42);
    match.phase = 'playing';
    match.players[1].incoming.push({ id: 1, lines: 3, eligibleTick: 0 });
    const prediction = new PlayerPrediction();
    prediction.reconcile(publicMatch(match).players[1], 0, 0);
    const drop = { held: 0, pressed: Button.hard };
    prediction.input(1, drop);
    prediction.input(2, drop);
    expect(prediction.player!.stats.pieces).toBe(1);
    expect(prediction.player!.stats.received).toBe(0);
    stepMatch(match, [NO_INPUT, drop]);
    prediction.reconcile(publicMatch(match).players[1], match.tick, 1);
    expect(prediction.player!.stats.received).toBe(3);
    expect(prediction.player!.stats.pieces).toBe(2);
  });

  it('never generates unpublished pieces when the public queue is exhausted', () => {
    const match = createMatch('versus', 42);
    const prediction = new PlayerPrediction();
    prediction.reconcile(publicMatch(match).players[1], 0, 0);
    const types = [match.players[1].active!.type, ...match.players[1].next];
    for (let i = 0; i < 6; i++) {
      prediction.input(i * 2 + 1, { held: 0, pressed: Button.hard });
      prediction.input(i * 2 + 2, NO_INPUT);
      expect(prediction.player!.board.flat().filter(Boolean)).toContain(types[i]);
    }
    expect(prediction.player!.next).toEqual([]);
    expect(prediction.player!.active).toBeNull();
    prediction.input(13, { held: 0, pressed: Button.hold });
    expect(prediction.player!.active).toBeNull();
    expect(prediction.player!.bag.rng).toBe(0);
  });

  it('waits when spawning and an empty hold would require two pieces but only one is known', () => {
    const match = createMatch('versus', 42);
    const prediction = new PlayerPrediction();
    prediction.reconcile(publicMatch(match).players[1], 0, 0);
    for (let i = 1; i <= 5; i++) prediction.input(i, { held: 0, pressed: Button.hard });
    expect(prediction.player!.next).toHaveLength(1);
    expect(prediction.player!.active).toBeNull();
    prediction.input(6, { held: 0, pressed: Button.hold });
    expect(prediction.player!.hold).toBeNull();
    expect(prediction.player!.active).toBeNull();
    expect(prediction.player!.next).toHaveLength(1);
  });
});
