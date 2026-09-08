import dtCanon from '../../src/templete/DT canon/DT_canon1.json' with { type: 'json' };
import dtCanon2 from '../../src/templete/DT canon/DT_canon2.json' with { type: 'json' };
import { cells, HIDDEN, WIDTH } from './pieces';
import type { Cell, Player, Spin, TemplateProgress } from './types';

type Pattern = { name: string; width: number; height: number; cells: number[][] };
export interface TemplateDefinition {
  id: string;
  name: string;
  voice?: string;
  stages: { pattern: Pattern; spin: Spin; rowsFromBottom: number[]; empty?: [number, number][] }[];
}

export const templateDefinitions: TemplateDefinition[] = [
  {
    id: 'dt-canon',
    name: dtCanon.name,
    voice: 'DT_canon1.mp3',
    stages: [
      {
        pattern: dtCanon,
        spin: 'full',
        rowsFromBottom: [3, 2],
        empty: [
          [1, 0],
          [1, 1],
          [2, 1],
        ],
      },
      {
        pattern: dtCanon2,
        spin: 'full',
        rowsFromBottom: [3, 2, 1],
        empty: [
          [1, 0],
          [1, 1],
          [2, 1],
        ],
      },
    ],
  },
];

interface Stage {
  name: string;
  filled: number[];
  empty: number[];
  spin: Spin;
  rows: number[];
  left: number;
}
export interface CompiledTemplate {
  id: string;
  width: number;
  variants: Stage[][];
}
export const MAX_TEMPLATE_CANDIDATES = 32;

export function compileTemplate(definition: TemplateDefinition): CompiledTemplate {
  if (definition.stages.length < 2) throw new Error(`Invalid stages: ${definition.id}`);
  const shapes = definition.stages.map(({ pattern, rowsFromBottom }) => {
    if (
      pattern.width !== WIDTH ||
      pattern.height !== 20 ||
      pattern.cells.length !== 20 ||
      !pattern.cells.every((row) => row.length === WIDTH && row.every((v) => v === 0 || v === 1))
    )
      throw new Error(`Invalid template: ${definition.id}`);
    const occupied = pattern.cells.flatMap((row, y) =>
      row.flatMap((v, x) => (v ? [[x, y] as const] : [])),
    );
    if (!occupied.length) throw new Error(`Empty template: ${definition.id}`);
    const top = Math.min(...occupied.map(([, y]) => y));
    const height = Math.max(...occupied.map(([, y]) => y)) - top + 1;
    if (
      !rowsFromBottom.length ||
      rowsFromBottom.length > 4 ||
      new Set(rowsFromBottom).size !== rowsFromBottom.length ||
      !rowsFromBottom.every((row) => Number.isInteger(row) && row >= 1 && row <= height)
    )
      throw new Error(`Invalid clear rows: ${definition.id}`);
    return { occupied, top, height };
  });
  // 段階ごとの幅が違っても同じ横座標を基準に反転する（DT canon2は右端1列がなくなる）。
  const left = Math.min(...shapes.flatMap((s) => s.occupied.map(([x]) => x)));
  const width = Math.max(...shapes.flatMap((s) => s.occupied.map(([x]) => x))) - left + 1;
  const variants = [false, true].map((mirror) =>
    definition.stages.map((step, index) => {
      const { occupied, top, height } = shapes[index];
      const mx = (x: number) => (mirror ? width - 1 - (x - left) : x - left);
      const filled = Array<number>(height).fill(0);
      for (const [x, y] of occupied) filled[y - top] |= 1 << mx(x);
      const empty = Array<number>(height).fill(0);
      for (const [x, y] of step.empty ?? []) {
        if (
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          x < 0 ||
          x >= width ||
          y < 0 ||
          y >= height
        )
          throw new Error(`Invalid empty cell: ${definition.id}`);
        const bit = 1 << (mirror ? width - 1 - x : x);
        if (filled[y] & bit) throw new Error(`Occupied empty cell: ${definition.id}`);
        empty[y] |= bit;
      }
      return {
        name: step.pattern.name,
        filled,
        empty,
        spin: step.spin,
        rows: step.rowsFromBottom.map((row) => height - row).sort((a, b) => a - b),
        left: Math.min(...occupied.map(([x]) => mx(x))),
      };
    }),
  );
  return { id: definition.id, width, variants };
}

export const compiledTemplates = templateDefinitions.map(compileTemplate);
const byId = new Map(compiledTemplates.map((template) => [template.id, template]));
const namesById = new Map(templateDefinitions.map((template) => [template.id, template.name]));
export const templateName = (id: string | undefined): string | undefined =>
  id === undefined ? undefined : namesById.get(id);
export const validTemplate = (id: unknown): id is string => typeof id === 'string' && byId.has(id);
export function templateStage(progress: TemplateProgress): Stage {
  return byId.get(progress.id)!.variants[progress.variant][progress.step];
}
export function validTemplateClear(id: unknown, spin: unknown, lines: unknown): boolean {
  if (!validTemplate(id)) return false;
  const last = byId.get(id)!.variants[0].at(-1)!;
  return spin === last.spin && lines === last.rows.length;
}
export function validTemplateProgress(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_TEMPLATE_CANDIDATES &&
      value.every((p) => {
        if (!p || !validTemplate(p.id)) return false;
        const template = byId.get(p.id)!;
        return (
          Number.isInteger(p.variant) &&
          p.variant >= 0 &&
          p.variant < template.variants.length &&
          Number.isInteger(p.step) &&
          p.step >= 0 &&
          p.step < template.variants[p.variant].length &&
          Number.isInteger(p.x) &&
          p.x >= 0 &&
          p.x <= WIDTH - template.width &&
          Number.isInteger(p.y) &&
          p.y >= 0 &&
          p.y + template.variants[p.variant][p.step].filled.length <= 40
        );
      }))
  );
}

export function boardMasks(board: Cell[][]): number[] {
  return board.map((row) => row.reduce((mask, cell, x) => mask | (cell === null ? 0 : 1 << x), 0));
}
function matches(board: number[], stage: Stage, x: number, y: number): boolean {
  if (y < 0 || y + stage.filled.length > board.length) return false;
  return stage.filled.every((mask, row) => {
    const actual = board[y + row] >>> x;
    return (actual & mask) === mask && (actual & stage.empty[row]) === 0;
  });
}

// JSONの1と、段階ごとに明示した入口の空間を照合する。周囲の追加ブロックは許可する。
export function detectTemplateShapes(
  board: number[],
  templates = compiledTemplates,
): TemplateProgress[] {
  const found: TemplateProgress[] = [];
  for (const template of templates)
    for (const [variant, stages] of template.variants.entries()) {
      const stage = stages[0];
      for (let y = 0; y <= board.length - stage.filled.length; y++)
        for (let x = 0; x <= WIDTH - template.width; x++)
          if (matches(board, stage, x, y)) found.push({ id: template.id, variant, x, y, step: 0 });
    }
  return found;
}
function storeProgress(player: Player, progress: TemplateProgress[]): void {
  const unique = new Map(progress.map((p) => [`${p.id}:${p.variant}:${p.x}:${p.y}:${p.step}`, p]));
  if (unique.size) player.templateProgress = [...unique.values()].slice(0, MAX_TEMPLATE_CANDIDATES);
  else delete player.templateProgress;
}
function shiftRow(y: number, cleared: number[]): number | null {
  return cleared.includes(y) ? null : y + cleared.filter((row) => row > y).length;
}

// 毎設置、固定済み・消去前の盤面で呼ぶ。消去後の盤面をビット列で作り、位置と段階を更新する。
export function recognizeTemplate(
  player: Player,
  cleared: number[],
  spin: Spin,
  templates = compiledTemplates,
): string | undefined {
  const fixed = boardMasks(player.board);
  const before = [...fixed];
  for (const [x, y] of cells(player.active!)) before[y + HIDDEN] &= ~(1 << x);
  const after = [
    ...Array<number>(cleared.length).fill(0),
    ...fixed.filter((_, y) => !cleared.includes(y)),
  ];
  // 発火時は保存件数の上限に依存せず、消去前の型を再確認する。
  const candidates = [
    ...(player.templateProgress ?? []).filter((p) => p.step > 0),
    ...(cleared.length ? detectTemplateShapes(before, templates) : []),
  ];
  const next: TemplateProgress[] = [];
  let completed: string | undefined;
  for (const p of candidates) {
    const template = byId.get(p.id)!;
    const stages = template.variants[p.variant];
    const stage = stages[p.step];
    if (!matches(before, stage, p.x, p.y)) continue;
    const correctClear =
      spin === stage.spin &&
      cleared.length === stage.rows.length &&
      stage.rows.every((row, i) => row + p.y === cleared[i]);
    if (correctClear && p.step === stages.length - 1) {
      completed ??= template.id;
      continue;
    }
    const y = shiftRow(p.y, cleared);
    if (y === null) continue;
    if (correctClear) {
      // 指定行を消した後、同じ型から変化した位置・向きに次の地形が実在することを確認する。
      if (matches(after, stages[p.step + 1], p.x, y)) next.push({ ...p, y, step: p.step + 1 });
    } else if (
      p.step > 0 &&
      !cleared.some((row) => row >= p.y && row < p.y + stage.filled.length) &&
      matches(after, stage, p.x, y)
    ) {
      // 型の外側の消去は解除せず、行のずれを補正して同じ段階を保持する。
      next.push({ ...p, y });
    }
  }
  // 新しく組まれた型や、別の行の消去で移動したDT canonを毎設置後に再検知する。
  storeProgress(player, [...next, ...detectTemplateShapes(after, templates)]);
  return completed;
}

export function shiftTemplates(player: Player, lines: number): void {
  if (!lines) return;
  const board = boardMasks(player.board);
  const shifted = (player.templateProgress ?? [])
    .filter((p) => p.step > 0)
    .map((p) => ({ ...p, y: p.y - lines }))
    .filter((p) => matches(board, templateStage(p), p.x, p.y));
  storeProgress(player, [...shifted, ...detectTemplateShapes(board)]);
}
