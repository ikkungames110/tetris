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
import { dtDouble } from '../helpers/dt-canon';
import { templateStage } from '../../packages/core/templates';
import { TemplateDebug } from '../../apps/web/template-debug';
import type { Player } from '../../packages/core/types';
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

function clearOutside(player: Player, below: boolean): void {
  if (below) {
    player.board[39].fill('G');
    player.board[39][9] = null;
    player.active = { type: 'I', x: 7, y: 16, rotation: 1 };
  } else {
    player.board[21].fill('G');
    for (let x = 0; x < 4; x++) player.board[21][x] = null;
    player.active = { type: 'I', x: 0, y: 0, rotation: 0 };
  }
  expect(lockPiece(player, 10).lines).toBe(1);
}

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
        expect(player.templateProgress![0]).toMatchObject({ step: 1, y: y + 22 });
        expect(templateStage(player.templateProgress![0]).name).toBe('DT canon2');
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

  it('requires the first shape and a qualifying Double before recognizing DT canon2', () => {
    const match = dtCanonMatch();
    const player = match.players[0];
    player.board[33][2] = null;
    step(match);
    expect(player.templateProgress?.some((p) => p.step === 1) ?? false).toBe(false);
    dtTriple(player);
    step(match);
    expect(match.events[0].template).toBeUndefined();
    const standalone = dtCanonMatch();
    step(standalone);
    delete standalone.players[0].templateProgress;
    dtTriple(standalone.players[0]);
    step(standalone);
    expect(standalone.events[0].template).toBeUndefined();
    expect(clearLabel(standalone.players[0], standalone.tick)).toBe('T-SPIN TRIPLE');
  });

  for (const stage of [0, 1])
    for (const below of [false, true])
      for (const mirror of [false, true]) {
        it(`updates stage ${stage} after an unrelated ${below ? 'lower' : 'upper'} clear, mirror=${mirror}`, () => {
          const match = dtCanonMatch(2, 7, mirror);
          const player = match.players[0];
          const debug = new TemplateDebug();
          if (stage === 1) step(match);
          else {
            player.active = { type: 'O', x: 0, y: 0, rotation: 0 };
            expect(lockPiece(player, 0).lines).toBe(0);
          }
          expect(player.templateProgress).toContainEqual({
            id: 'dt-canon',
            variant: Number(mirror),
            step: stage,
            x: 2,
            y: 27 + stage * 2,
          });
          debug.update(player, 0);
          const old = debug.message;
          clearOutside(player, below);
          const shift = Number(below);
          expect(player.templateProgress).toContainEqual({
            id: 'dt-canon',
            variant: Number(mirror),
            step: stage,
            x: 2,
            y: 27 + stage * 2 + shift,
          });
          debug.update(player, 0);
          if (below) expect(debug.message).not.toBe(old);
          else expect(debug.message).toBe(old);
          if (stage === 0) {
            player.active = dtDouble(2, 7 + shift, mirror);
            player.rotationKick = 0;
            step(match);
          }
          expect(templateStage(player.templateProgress![0]).name).toBe('DT canon2');
          dtTriple(player, 2, 7 + shift, mirror);
          step(match);
          expect(match.events[0].template).toBe('dt-canon');
        });
      }

  it('does not advance on a Double in other rows, but still detects the original shape afterward', () => {
    const match = dtCanonMatch();
    const player = match.players[0];
    player.board[21] = Array.from({ length: 10 }, (_, x) => (x === 4 ? null : 'L'));
    player.board[22] = Array.from({ length: 10 }, (_, x) => ([3, 4, 5].includes(x) ? null : 'L'));
    player.board[23][3] = player.board[23][5] = 'L';
    player.active = { type: 'T', x: 3, y: 1, rotation: 0 };
    player.rotationKick = 0;
    const clear = lockPiece(player, 1);
    expect(clear).toMatchObject({ spin: 'full', lines: 2 });
    expect(player.templateProgress).toContainEqual({
      id: 'dt-canon',
      x: 0,
      y: 33,
      variant: 0,
      step: 0,
    });
    expect(player.templateProgress!.every((p) => p.step === 0)).toBe(true);
    player.active = dtDouble();
    player.rotationKick = 0;
    step(match);
    expect(player.templateProgress![0]).toMatchObject({ step: 1, y: 35 });
  });

  it('allows a non-clearing placement outside the shape and tracks rising garbage', () => {
    const match = dtCanonMatch();
    const player = match.players[0];
    step(match);
    player.active = { type: 'O', x: 4, y: 12, rotation: 0 };
    lockPiece(player, ++match.tick);
    expect(player.templateProgress).toHaveLength(1);
    player.incoming = [{ id: 1, eligibleTick: 0, lines: 2 }];
    expect(receiveGarbage(player, match.tick)).toBe(2);
    expect(player.templateProgress![0].y).toBe(33);
    dtTriple(player, 0, 11);
    step(match);
    expect(match.events[0].template).toBe('dt-canon');
  });

  it('cancels when the tracked rows are removed with the wrong spin, and resets on a new round', () => {
    const match = dtCanonMatch();
    step(match);
    const player = match.players[0];
    dtTriple(player);
    player.rotationKick = null;
    step(match);
    expect(match.events[0].template).toBeUndefined();
    expect(player.templateProgress).toBeUndefined();
    const next = dtCanonMatch();
    step(next);
    next.phase = 'roundOver';
    nextRound(next);
    expect(next.players[0].templateProgress).toBeUndefined();
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
