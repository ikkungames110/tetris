import { describe, expect, it } from 'vitest';
import {
  lockPiece,
  nextRound,
  receiveGarbage,
  stateHash,
  stepMatch,
} from '../../packages/core/engine';
import { Button, NO_INPUT, type Match } from '../../packages/core/types';
import { clearLabel } from '../../apps/web/render';
import { clearSound, eventSounds } from '../../apps/web/audio';
import { dtCanonMatch, dtTriple } from '../helpers/dt-canon';
import { PlayerPrediction } from '../../packages/network/prediction';
import {
  displayMatch,
  encodeServerMessage,
  parseServerMessage,
  publicMatch,
  type RoomState,
} from '../../packages/protocol/online';

const drop = { held: 0, pressed: Button.hard };
const step = (match: Match) => stepMatch(match, [drop, NO_INPUT]);

describe('DT canon', () => {
  for (const mirror of [false, true])
    for (const [x, y] of [
      [0, 13],
      [2, 7],
      [5, 2],
    ]) {
      it(`recognizes Double→Triple at ${x},${y}, mirror=${mirror}`, () => {
        const match = dtCanonMatch(x, y, mirror);
        const player = match.players[0];
        step(match);
        expect(match.events[0]).toMatchObject({ type: 'clear', spin: 'full', amount: 2 });
        expect(clearLabel(player, match.tick)).toBe('T-SPIN DOUBLE');
        expect(clearSound(match.events[0])).toBe('t_spin_double');
        expect(player.templateProgress).toHaveLength(1);
        dtTriple(player, x, y, mirror);
        step(match);
        expect(match.events[0]).toMatchObject({
          type: 'clear',
          spin: 'full',
          amount: 3,
          template: 'dt-canon',
        });
        expect(clearLabel(player, match.tick)).toBe('DT canon');
        expect(clearLabel(player, match.tick + 151)).toBe('');
        expect(eventSounds(match.events[0])).toEqual(['clear_tspin_a', 'template:dt-canon']);
        expect(player.templateProgress).toBeUndefined();
      });
    }

  it('requires the supplied shape and its T spaces, not just consecutive spin counts', () => {
    for (const change of ['missing block', 'blocked space']) {
      const match = dtCanonMatch();
      const player = match.players[0];
      if (change === 'missing block') player.board[39][1] = null;
      else player.board[39][2] = 'O'; // 支えの間は自由。Tripleの空間を塞ぐ場合だけ解除。
      if (change === 'blocked space') player.board[37][2] = 'O';
      step(match);
      expect(player.templateProgress).toBeUndefined();
    }
    const match = dtCanonMatch();
    step(match);
    delete match.players[0].templateProgress;
    dtTriple(match.players[0]);
    step(match);
    expect(match.events[0].template).toBeUndefined();
    expect(clearLabel(match.players[0], match.tick)).toBe('T-SPIN TRIPLE');
  });

  it('allows a non-clearing placement outside the shape and tracks rising garbage', () => {
    const match = dtCanonMatch();
    const player = match.players[0];
    step(match);
    player.active = { type: 'O', x: 7, y: 18, rotation: 0 };
    lockPiece(player, ++match.tick);
    expect(player.templateProgress).toHaveLength(1);
    player.incoming = [{ id: 1, eligibleTick: 0, lines: 2 }];
    expect(receiveGarbage(player, match.tick)).toBe(2);
    expect(player.templateProgress![0].y).toBe(31);
    dtTriple(player, 0, 11);
    step(match);
    expect(match.events[0].template).toBe('dt-canon');
  });

  it('cancels on an unrelated clear, filled cavity, wrong spin, and a new round', () => {
    for (const reason of ['clear', 'cavity', 'spin', 'round']) {
      const match = dtCanonMatch();
      const player = match.players[0];
      step(match);
      if (reason === 'round') {
        match.phase = 'roundOver';
        nextRound(match);
        expect(match.players[0].templateProgress).toBeUndefined();
        continue;
      }
      if (reason === 'clear') {
        player.board[39].fill('G');
        player.board[39][9] = null;
        player.active = { type: 'I', x: 7, y: 16, rotation: 1 };
        lockPiece(player, ++match.tick);
      } else if (reason === 'cavity') {
        player.active = { type: 'T', x: 1, y: 15, rotation: 3 };
        for (const y of [35, 36, 37]) player.board[y][9] = null;
        // 消去なしでも必要空間を埋める設置は解除する。
        lockPiece(player, ++match.tick);
      } else {
        dtTriple(player);
        player.rotationKick = null;
        step(match);
        expect(match.events[0].template).toBeUndefined();
      }
      expect(player.templateProgress).toBeUndefined();
    }
  });

  it('rejects a Triple at a different position even when another DT shape is pending', () => {
    const match = dtCanonMatch();
    step(match);
    const other = dtCanonMatch(5, 4, true);
    step(other);
    match.players[0].board = other.players[0].board;
    dtTriple(match.players[0], 5, 4, true);
    step(match);
    expect(match.events[0]).toMatchObject({ amount: 3, spin: 'full' });
    expect(match.events[0].template).toBeUndefined();
  });

  it('carries progress and completion through snapshots and prediction without changing replay hashes', () => {
    const match = dtCanonMatch();
    match.mode = 'versus';
    step(match);
    dtTriple(match.players[0]);
    const room: RoomState = {
      type: 'room',
      kind: 'private',
      handicap: null,
      code: 'ABCDEF',
      matchId: 'dt',
      connected: [true, true],
      ready: [true, true],
      ack: [1, 1],
      nextRoundIn: null,
      match: publicMatch(match),
    };
    expect(parseServerMessage(encodeServerMessage(room))).toEqual(room);
    const prediction = new PlayerPrediction();
    prediction.reconcile(room.match!.players[0], match.tick, 1);
    prediction.input(2, drop);
    step(match);
    expect(prediction.player!.lastClear?.template).toBe('dt-canon');
    room.match = publicMatch(match);
    expect(parseServerMessage(encodeServerMessage(room))).toEqual(room);
    expect(clearLabel(displayMatch(room.match).players[0], match.tick)).toBe('DT canon');
    const legacy = structuredClone(match);
    delete legacy.players[0].lastClear!.template;
    delete legacy.events[0].template;
    expect(stateHash(match)).toBe(stateHash(legacy));
    legacy.players[0].templateProgress = [{ id: 'dt-canon', variant: 0, x: 0, y: 33, step: 1 }];
    expect(stateHash(match)).toBe(stateHash(legacy));
    for (const progress of [
      [{ id: 'unknown', variant: 0, x: 0, y: 33, step: 1 }],
      [{ id: 'dt-canon', variant: 4, x: 0, y: 33, step: 1 }],
      Array(33).fill({ id: 'dt-canon', variant: 0, x: 0, y: 33, step: 1 }),
    ]) {
      const invalid = structuredClone(room);
      invalid.match!.players[0].templateProgress = progress;
      expect(parseServerMessage(encodeServerMessage(invalid))).toBeNull();
    }
    room.match.events[0].template = 'unknown';
    expect(parseServerMessage(encodeServerMessage(room))).toBeNull();
  });
});
