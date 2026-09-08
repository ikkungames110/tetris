import dtCanon from '../../src/templete/DT canon/DT canon.json' with { type: 'json' };
import { cells, HIDDEN, WIDTH } from './pieces';
import type { Cell, Player, Point, Spin, TemplateProgress } from './types';

export interface TemplateDefinition {
  id: string;
  name: string;
  pattern: { width: number; height: number; cells: number[][] };
  // 座標はブロックを含む最小矩形の左上を原点とする。0のセルは空間指定以外は自由。
  sequence: { spin: Spin; rows: number[]; mino: Point[] }[];
}

export const templateDefinitions: TemplateDefinition[] = [
  {
    id: 'dt-canon',
    name: dtCanon.name,
    pattern: dtCanon,
    sequence: [
      {
        spin: 'full',
        rows: [0, 1],
        mino: [
          [1, 0],
          [0, 1],
          [1, 1],
          [2, 1],
        ],
      },
      {
        spin: 'full',
        rows: [2, 3, 4],
        mino: [
          [2, 2],
          [1, 3],
          [2, 3],
          [2, 4],
        ],
      },
    ],
  },
];

interface Stage {
  left: number;
  filled: number[];
  empty: number[];
  spin: Spin;
  rows: number[];
  mino: Point[];
}
export interface CompiledTemplate {
  id: string;
  width: number;
  variants: Stage[][];
}
export const MAX_TEMPLATE_CANDIDATES = 32;

export function compileTemplate(definition: TemplateDefinition): CompiledTemplate {
  const { pattern, sequence } = definition;
  if (
    pattern.width !== WIDTH ||
    pattern.height !== 20 ||
    pattern.cells.length !== pattern.height ||
    !pattern.cells.every(
      (row) => row.length === pattern.width && row.every((v) => v === 0 || v === 1),
    ) ||
    sequence.length < 2
  )
    throw new Error(`Invalid template: ${definition.id}`);
  const occupied = pattern.cells.flatMap((row, y) =>
    row.flatMap((v, x) => (v ? [[x, y] as const] : [])),
  );
  if (!occupied.length) throw new Error(`Empty template: ${definition.id}`);
  const left = Math.min(...occupied.map(([x]) => x));
  const top = Math.min(...occupied.map(([, y]) => y));
  const width = Math.max(...occupied.map(([x]) => x)) - left + 1;
  const height = Math.max(...occupied.map(([, y]) => y)) - top + 1;
  const variants = [false, true].map((mirror) => {
    const mx = (x: number) => (mirror ? width - 1 - x : x);
    let filled = Array<number>(height).fill(0);
    let empty = Array<number>(height).fill(0);
    for (const [x, y] of occupied) filled[y - top] |= 1 << mx(x - left);
    for (const step of sequence) {
      if (
        !step.rows.length ||
        step.rows.length > 4 ||
        new Set(step.rows).size !== step.rows.length ||
        !step.rows.every((y) => Number.isInteger(y) && y >= 0 && y < height) ||
        step.mino.length !== 4 ||
        !['none', 'mini', 'full'].includes(step.spin)
      )
        throw new Error(`Invalid sequence: ${definition.id}`);
      for (const [x, y] of step.mino) {
        if (
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          x < 0 ||
          x >= width ||
          y < 0 ||
          y >= height ||
          filled[y] & (1 << mx(x))
        )
          throw new Error(`Invalid mino space: ${definition.id}`);
        empty[y] |= 1 << mx(x);
      }
    }
    let rowMap = Array.from({ length: height }, (_, y) => y);
    return sequence.map((step) => {
      const rows = step.rows.map((y) => rowMap[y]).sort((a, b) => a - b);
      const mino = step.mino.map(([x, y]) => [mx(x), rowMap[y]] as const);
      if (rows.some((y) => y < 0) || mino.some(([, y]) => y < 0))
        throw new Error(`Sequence uses an erased row: ${definition.id}`);
      const stage = {
        filled: [...filled],
        empty: [...empty],
        spin: step.spin,
        rows,
        mino,
        left: Math.min(...mino.map(([x]) => x)),
      };
      for (const [x, y] of mino) {
        filled[y] |= 1 << x;
        empty[y] &= ~(1 << x);
      }
      const advance = (masks: number[]) => [
        ...Array<number>(rows.length).fill(0),
        ...masks.filter((_, y) => !rows.includes(y)),
      ];
      filled = advance(filled);
      empty = advance(empty);
      rowMap = rowMap.map((y) =>
        y < 0 || rows.includes(y) ? -1 : y + rows.filter((r) => r > y).length,
      );
      return stage;
    });
  });
  return { id: definition.id, width, variants };
}

export const compiledTemplates = templateDefinitions.map(compileTemplate);
const byId = new Map(compiledTemplates.map((template) => [template.id, template]));
const namesById = new Map(templateDefinitions.map((template) => [template.id, template.name]));
export const templateName = (id: string | undefined): string | undefined =>
  id === undefined ? undefined : namesById.get(id);
export const validTemplate = (id: unknown): id is string => typeof id === 'string' && byId.has(id);
export function validTemplateClear(id: unknown, spin: unknown, lines: unknown): boolean {
  if (!validTemplate(id)) return false;
  const last = byId.get(id)!.variants[0].at(-1)!;
  return spin === last.spin && lines === last.rows.length;
}

export function validTemplateProgress(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.length <= MAX_TEMPLATE_CANDIDATES &&
    value.every((p) => {
      if (!p || !validTemplate(p.id)) return false;
      const template = byId.get(p.id)!;
      return (
        Number.isInteger(p.variant) &&
        p.variant >= 0 &&
        p.variant < template.variants.length &&
        Number.isInteger(p.step) &&
        p.step > 0 &&
        p.step < template.variants[p.variant].length &&
        Number.isInteger(p.x) &&
        p.x >= 0 &&
        p.x <= WIDTH - template.width &&
        Number.isInteger(p.y) &&
        p.y >= 0 &&
        p.y + template.variants[p.variant][p.step].filled.length <= 40
      );
    })
  );
}

export function boardMasks(board: Cell[][]): number[] {
  return board.map((row) => row.reduce((mask, cell, x) => mask | (cell === null ? 0 : 1 << x), 0));
}

function matches(board: number[], stage: Stage, x: number, y: number): boolean {
  if (y < 0 || y + stage.filled.length > board.length) return false;
  for (let row = 0; row < stage.filled.length; row++) {
    const bits = board[y + row] >>> x;
    if ((bits & stage.filled[row]) !== stage.filled[row] || (bits & stage.empty[row]) !== 0)
      return false;
  }
  return true;
}

function matchesClear(
  stage: Stage,
  x: number,
  y: number,
  cleared: number[],
  spin: Spin,
  fixed: readonly Point[],
): boolean {
  return (
    spin === stage.spin &&
    cleared.length === stage.rows.length &&
    stage.rows.every((row, i) => row + y === cleared[i]) &&
    stage.mino.every(([mx, my]) =>
      fixed.some(([fx, fy]) => fx === mx + x && fy + HIDDEN === my + y),
    )
  );
}

// 固定済み・消去前の盤面で呼ぶ。移動/回転/描画tickでは走査しない。
export function recognizeTemplate(
  player: Player,
  cleared: number[],
  spin: Spin,
  templates = compiledTemplates,
): string | undefined {
  const starters = cleared.length
    ? templates.filter(
        (t) => t.variants[0][0].rows.length === cleared.length && t.variants[0][0].spin === spin,
      )
    : [];
  if (!player.templateProgress?.length && !starters.length) return;
  const after = boardMasks(player.board);
  const before = [...after];
  const fixed = cells(player.active!);
  const fixedLeft = Math.min(...fixed.map(([x]) => x));
  for (const [x, y] of fixed) before[y + HIDDEN] &= ~(1 << x);
  const pending: TemplateProgress[] = [];
  let completed: string | undefined;
  for (const progress of player.templateProgress ?? []) {
    const template = byId.get(progress.id)!;
    const stage = template.variants[progress.variant][progress.step];
    if (!cleared.length) {
      if (matches(after, stage, progress.x, progress.y)) pending.push(progress);
    } else if (
      matches(before, stage, progress.x, progress.y) &&
      matchesClear(stage, progress.x, progress.y, cleared, spin, fixed)
    ) {
      if (progress.step + 1 === template.variants[progress.variant].length)
        completed ??= template.id;
      else pending.push({ ...progress, step: progress.step + 1 });
    }
    // 別のライン消去・必要空間の埋まりは連携を解除する。
  }
  if (!completed)
    for (const template of starters) {
      for (const [variant, stages] of template.variants.entries()) {
        const stage = stages[0];
        const y = cleared[0] - stage.rows[0];
        const x = fixedLeft - stage.left;
        if (pending.length >= MAX_TEMPLATE_CANDIDATES) break;
        if (
          x >= 0 &&
          x <= WIDTH - template.width &&
          matchesClear(stage, x, y, cleared, spin, fixed) &&
          matches(before, stage, x, y)
        )
          pending.push({ id: template.id, variant, x, y, step: 1 });
      }
    }
  if (pending.length) player.templateProgress = pending;
  else delete player.templateProgress;
  return completed;
}

export function shiftTemplates(player: Player, lines: number): void {
  if (!lines || !player.templateProgress) return;
  player.templateProgress = player.templateProgress
    .map((p) => ({ ...p, y: p.y - lines }))
    .filter((p) => p.y >= 0);
  if (!player.templateProgress.length) delete player.templateProgress;
}
