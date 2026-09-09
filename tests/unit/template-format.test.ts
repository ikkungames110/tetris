import { describe, expect, it } from 'vitest';
import dtCanon from '../../src/templete/DT canon/DT canon_new.json' with { type: 'json' };
import { detectSpin } from '../../packages/core/attack';
import { createMatch } from '../../packages/core/engine';
import { cells, HIDDEN } from '../../packages/core/pieces';
import {
  compileTemplate,
  recognizeTemplate,
  type TemplateDefinition,
} from '../../packages/core/templates';
import type { Player } from '../../packages/core/types';
import { dtCanonMatch } from '../helpers/dt-canon';

const definition = (): TemplateDefinition => ({ ...structuredClone(dtCanon), id: 'dt-canon' });

describe('state-based template JSON', () => {
  it('derives terrain, cavities, clear rows, state names and mirrored T positions from one JSON', () => {
    const template = compileTemplate(definition());
    expect(template.width).toBe(5);
    const [double, triple] = template.variants[0];
    expect(double).toMatchObject({
      name: 'DT canon / 状態1',
      top: 13,
      filled: [12, 8, 10, 25, 17, 10, 10],
      empty: [2, 6, 4, 6, 14, 4, 4],
      t: [
        [1, 4],
        [2, 4],
        [3, 4],
        [2, 5],
      ],
      rows: [4, 5],
    });
    expect(triple).toMatchObject({
      name: 'DT canon / 状態2',
      top: 15,
      filled: [12, 8, 10, 9, 10],
      empty: [2, 6, 4, 6, 4],
      t: [
        [2, 2],
        [1, 3],
        [2, 3],
        [2, 4],
      ],
      rows: [2, 3, 4],
    });
    expect(template.variants[1][1]).toMatchObject({
      left: 1,
      t: [
        [2, 2],
        [3, 3],
        [2, 3],
        [2, 4],
      ],
    });
  });

  it('uses cellTypes values rather than assuming 0, 1 and 2', () => {
    const source = definition();
    source.cellTypes = { empty: 7, gray: 0, t: 9 };
    for (const state of source.states)
      state.cells = state.cells.map((row) => row.map((value) => [7, 0, 9][value]));
    expect(compileTemplate(source)).toEqual(compileTemplate(definition()));
  });

  const invalid: [string, (source: TemplateDefinition) => void][] = [
    [
      'wrong width',
      (s) => {
        s.width = 9;
      },
    ],
    [
      'wrong height',
      (s) => {
        s.height = 19;
      },
    ],
    [
      'duplicate cell types',
      (s) => {
        s.cellTypes.t = s.cellTypes.gray;
      },
    ],
    [
      'fractional cell type',
      (s) => {
        s.cellTypes.t = 1.5;
      },
    ],
    [
      'no states',
      (s) => {
        s.states = [];
      },
    ],
    [
      'missing state name',
      (s) => {
        s.states[0].name = '';
      },
    ],
    [
      'missing row',
      (s) => {
        s.states[0].cells.pop();
      },
    ],
    [
      'short row',
      (s) => {
        s.states[0].cells[0].pop();
      },
    ],
    [
      'unknown cell',
      (s) => {
        s.states[0].cells[0][0] = 3;
      },
    ],
    [
      'missing T cell',
      (s) => {
        s.states[0].cells[18][2] = 0;
      },
    ],
    [
      'extra T cell',
      (s) => {
        s.states[0].cells[19][2] = 2;
      },
    ],
    [
      'disconnected T cells',
      (s) => {
        s.states[0].cells[18][2] = 0;
        s.states[0].cells[0][0] = 2;
      },
    ],
    [
      'four cells in a different tetromino shape',
      (s) => {
        s.states[0].cells[18][2] = 0;
        s.states[0].cells[17][4] = 2;
      },
    ],
    [
      'no terrain',
      (s) => {
        s.states[0].cells = s.states[0].cells.map((row) => row.map((v) => (v === 1 ? 0 : v)));
      },
    ],
  ];
  it.each(invalid)('rejects %s', (_, mutate) => {
    const source = definition();
    mutate(source);
    expect(() => compileTemplate(source)).toThrow();
  });

  it('rejects matching clear metadata when the locked T is elsewhere', () => {
    const player = dtCanonMatch().players[0];
    player.active = { type: 'T', x: 6, y: 16, rotation: 2 };
    for (const [x, y] of cells(player.active)) player.board[y + HIDDEN][x] = 'T';
    expect(recognizeTemplate(player, [37, 38], 'full')).toBeUndefined();
    expect(player.templateProgress?.some((p) => p.step > 0) ?? false).toBe(false);
  });

  // 積み重ねたDoubleの穴を上から順に消す。各状態の上端自体が消える配置。
  function stackedDoubles(count: number): TemplateDefinition {
    return {
      id: 'stacked-doubles',
      name: 'Stacked Doubles',
      width: 10,
      height: 20,
      cellTypes: { empty: 0, gray: 1, t: 2 },
      states: Array.from({ length: count }, (_, step) => {
        const board = Array.from({ length: 20 }, () => Array<number>(10).fill(0));
        const top = 20 - 2 * (count - step);
        for (let y = top; y < 20; y += 2) {
          for (const x of [2, 3, 5, 6]) board[y][x] = 1;
          board[y + 1][2] = board[y + 1][6] = 1;
        }
        board[top][4] = 2;
        for (const x of [3, 4, 5]) board[top + 1][x] = 2;
        return { name: `状態${step + 1}`, cells: board };
      }),
    };
  }

  function preparePlayer(source: TemplateDefinition): Player {
    const player = createMatch('practice', 42).players[0];
    source.states[0].cells.forEach((row, y) => {
      if (row.every((value) => value === 0)) return;
      row.forEach((value, x) => {
        if (value === 1 || x < 2 || x > 6) player.board[y + HIDDEN][x] = 'G';
      });
    });
    return player;
  }

  it.each([1, 3])(
    'completes all %i states, using JSON coordinates when the previous top row is cleared',
    (count) => {
      const source = stackedDoubles(count);
      const compiled = compileTemplate(source);
      const player = preparePlayer(source);
      for (let step = 0; step < count; step++) {
        const top = 20 - 2 * (count - step);
        player.active = { type: 'T', x: 3, y: top, rotation: 0 };
        player.rotationKick = 0;
        const spin = detectSpin(player);
        expect(spin).toBe('full');
        for (const [x, y] of cells(player.active)) player.board[y + HIDDEN][x] = 'T';
        const cleared = player.board.flatMap((row, y) =>
          row.every((cell) => cell !== null) ? [y] : [],
        );
        expect(cleared).toEqual([top + HIDDEN, top + HIDDEN + 1]);
        const result = recognizeTemplate(player, cleared, spin, [compiled]);
        if (step === count - 1) {
          expect(result).toBe(source.id);
          expect(player.templateProgress).toBeUndefined();
        } else {
          expect(result).toBeUndefined();
          expect(player.templateProgress).toContainEqual({
            id: source.id,
            variant: 0,
            x: 2,
            y: top + HIDDEN + 2,
            step: step + 1,
          });
        }
        player.board = [
          ...Array.from({ length: cleared.length }, () => Array(10).fill(null)),
          ...player.board.filter((_, y) => !cleared.includes(y)),
        ];
      }
    },
  );
});
