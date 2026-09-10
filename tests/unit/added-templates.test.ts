import { describe, expect, it } from 'vitest';
import { clearSound, eventSounds } from '../../apps/web/audio';
import { clearLabel } from '../../apps/web/render';
import { lockPiece, stateHash, stepMatch } from '../../packages/core/engine';
import { cells, collides, HIDDEN, WIDTH } from '../../packages/core/pieces';
import { compiledTemplates } from '../../packages/core/templates';
import { Button, NO_INPUT } from '../../packages/core/types';
import {
  encodeServerMessage,
  parseServerMessage,
  publicMatch,
  type RoomState,
} from '../../packages/protocol/online';
import { prepareTemplatePiece, templateCases, templateMatch } from '../helpers/templates';

const drop = { held: 0, pressed: Button.hard };

describe.each(templateCases)('$name', (example) => {
  it('derives the intended clear rows, including separated rows and a surviving T cell', () => {
    const compiled = compiledTemplates.find((t) => t.id === example.id)!;
    for (const stages of compiled.variants)
      expect(stages.map((s) => s.rows.map((y) => s.top + y))).toEqual(example.rows);
  });

  for (const mirror of [false, true])
    for (const [x, dy] of [
      [0, 0],
      [2, -6],
      [WIDTH - example.width, -12],
    ])
      it(`completes both T-spins at x=${x}, dy=${dy}, mirror=${mirror}`, () => {
        const match = templateMatch(example, x, dy, mirror);
        const player = match.players[0];
        for (let step = 0; step < 2; step++) {
          prepareTemplatePiece(player, example, step, x, dy, mirror);
          expect(collides(player.board, player.active!)).toBe(false);
          expect(collides(player.board, { ...player.active!, y: player.active!.y + 1 })).toBe(true);
          const rows: number[] = [];
          const result = lockPiece(player, step + 1, undefined, (_, clear) => {
            rows.push(...clear.rows.map((r) => r.y));
          });
          expect(rows).toEqual(example.rows[step].map((y) => y + dy));
          expect(result).toMatchObject({ lines: example.rows[step].length, spin: 'full' });
          if (step === 0) {
            expect(result.template).toBeUndefined();
            expect(player.templateProgress).toContainEqual({
              id: example.id,
              variant: Number(mirror),
              x,
              y: 37 + dy,
              step: 1,
            });
          } else {
            expect(result.template).toBe(example.id);
            expect(clearLabel(player, 2)).toBe(example.name);
            expect(
              player.templateProgress?.some((p) => p.id === example.id && p.step > 0) ?? false,
            ).toBe(false);
          }
        }
      });

  it.each([false, true])('keeps progress after an unrelated lower clear, mirror=%s', (mirror) => {
    const match = templateMatch(example, 2, -6, mirror);
    const player = match.players[0];
    lockPiece(player, 1);
    player.board[39].fill('G');
    for (let x = 6; x < 10; x++) player.board[39][x] = null;
    player.active = { type: 'I', x: 6, y: 18, rotation: 0 };
    expect(lockPiece(player, 2).lines).toBe(1);
    expect(player.templateProgress).toContainEqual({
      id: example.id,
      variant: Number(mirror),
      x: 2,
      y: 32,
      step: 1,
    });
    prepareTemplatePiece(player, example, 1, 2, -5, mirror);
    expect(lockPiece(player, 3).template).toBe(example.id);
  });

  it('requires the preceding clear and rejects an ordinary clear in either stage', () => {
    const standalone = templateMatch(example, example.left, 0, false, 1);
    expect(lockPiece(standalone.players[0], 1).template).toBeUndefined();
    for (const wrongStep of [0, 1]) {
      const player = templateMatch(example).players[0];
      if (wrongStep === 1) lockPiece(player, 1);
      prepareTemplatePiece(player, example, wrongStep);
      player.rotationKick = null;
      expect(lockPiece(player, 2)).toMatchObject({
        spin: 'none',
        lines: example.rows[wrongStep].length,
      });
      expect(player.lastClear?.template).toBeUndefined();
      expect(player.templateProgress?.some((p) => p.id === example.id && p.step > 0) ?? false).toBe(
        false,
      );
      if (wrongStep === 0) {
        prepareTemplatePiece(player, example, 1);
        expect(lockPiece(player, 3).template).toBeUndefined();
      }
    }
  });

  it('cancels progress if the next T slot is blocked', () => {
    const player = templateMatch(example).players[0];
    lockPiece(player, 1);
    prepareTemplatePiece(player, example, 1);
    const [x, y] = cells(player.active!)[0];
    player.board[HIDDEN + y][x] = 'G';
    player.active = { type: 'O', x: 7, y: 0, rotation: 0 };
    lockPiece(player, 2);
    expect(player.templateProgress?.some((p) => p.id === example.id && p.step > 0) ?? false).toBe(
      false,
    );
  });

  it('shares progress and completion over the protocol and selects the dedicated voice', () => {
    const match = templateMatch(example);
    match.mode = 'versus';
    for (let step = 0; step < 2; step++) {
      prepareTemplatePiece(match.players[0], example, step);
      stepMatch(match, [drop, NO_INPUT]);
      const message: RoomState = {
        type: 'room',
        kind: 'private',
        handicap: null,
        code: 'ABCDEF',
        matchId: example.id,
        winsRequired: 3,
        names: ['ゲスト', 'ゲスト'],
        connected: [true, true],
        ready: [true, true],
        nextRoundIn: null,
        match: publicMatch(match),
        ack: [0, 0],
      };
      expect(parseServerMessage(encodeServerMessage(message))).toEqual(message);
      const invalid = structuredClone(message);
      invalid.match!.players[0].rotationKick = 6;
      expect(parseServerMessage(encodeServerMessage(invalid))).toBeNull();
      const legacy = structuredClone(match);
      delete legacy.players[0].templateProgress;
      delete legacy.players[0].lastClear!.template;
      for (const event of legacy.events) delete event.template;
      expect(stateHash(match)).toBe(stateHash(legacy));
    }
    expect(eventSounds(match.events[0])).toEqual(['clear_tspin_a', `template:${example.id}`]);
    expect(clearSound({ ...match.events[0], perfect: true })).toBe('Perfect_clear');
  });
});
