import dtCanon from '../../src/templete/DT canon/DT canon_new.json' with { type: 'json' };
import { cells, HEIGHT, HIDDEN, WIDTH } from './pieces';
import type { Cell, Player, Point, Spin, TemplateProgress } from './types';

export interface TemplateDefinition {
  id: string;
  name: string;
  voice?: string;
  width: number;
  height: number;
  cellTypes: { empty: number; gray: number; t: number };
  states: { name: string; cells: number[][] }[];
}

export const templateDefinitions: TemplateDefinition[] = [
  { ...dtCanon, id: 'dt-canon', voice: 'DT_canon1.mp3' },
];

interface Stage {
  name: string;
  filled: number[];
  empty: number[];
  t: Point[];
  spin: Spin;
  rows: number[];
  left: number;
  top: number;
}
export interface CompiledTemplate {
  id: string;
  width: number;
  variants: Stage[][];
}
export const MAX_TEMPLATE_CANDIDATES = 32;

export function compileTemplate(definition: TemplateDefinition): CompiledTemplate {
  const { cellTypes, states } = definition;
  if (
    definition.width !== WIDTH ||
    definition.height !== HEIGHT ||
    !cellTypes ||
    ![cellTypes.empty, cellTypes.gray, cellTypes.t].every((v) => Number.isInteger(v) && v >= 0) ||
    new Set([cellTypes.empty, cellTypes.gray, cellTypes.t]).size !== 3 ||
    !Array.isArray(states) ||
    !states.length
  )
    throw new Error(`Invalid template: ${definition.id}`);
  const shapes = states.map((state) => {
    if (
      !state ||
      typeof state.name !== 'string' ||
      !state.name.trim() ||
      !Array.isArray(state.cells) ||
      state.cells.length !== HEIGHT ||
      !state.cells.every(
        (row) =>
          Array.isArray(row) &&
          row.length === WIDTH &&
          row.every((v) => v === cellTypes.empty || v === cellTypes.gray || v === cellTypes.t),
      )
    )
      throw new Error(`Invalid state: ${definition.id}`);
    const points = (value: number): Point[] =>
      state.cells.flatMap((row, y) =>
        row.flatMap((v, x) => (v === value ? [[x, y] as const] : [])),
      );
    const gray = points(cellTypes.gray);
    const t = points(cellTypes.t);
    if (!gray.length) throw new Error(`Empty terrain: ${definition.id} / ${state.name}`);
    // 4マスのうち1マスが他の3マスと隣接する形は、4方向いずれかのTミノ。
    if (
      t.length !== 4 ||
      !t.some(
        ([x, y]) => t.filter(([tx, ty]) => Math.abs(tx - x) + Math.abs(ty - y) === 1).length === 3,
      )
    )
      throw new Error(`Invalid T placement: ${definition.id} / ${state.name}`);
    const occupied = [...gray, ...t];
    const top = Math.min(...occupied.map(([, y]) => y));
    const height = Math.max(...occupied.map(([, y]) => y)) - top + 1;
    const left = Math.min(...occupied.map(([x]) => x));
    const right = Math.max(...occupied.map(([x]) => x));
    // 型の内側の0とTの位置は空き必須。両端の0と型の外側は積み足しを許可する。
    const empty = points(cellTypes.empty).filter(
      ([x, y]) => x > left && x < right && y >= top && y < top + height,
    );
    return { gray, t, occupied, empty, top, height };
  });
  // 全状態の共通幅で反転し、段階ごとの横位置の関係を保つ。
  const left = Math.min(...shapes.flatMap((s) => s.occupied.map(([x]) => x)));
  const width = Math.max(...shapes.flatMap((s) => s.occupied.map(([x]) => x))) - left + 1;
  const variants = [false, true].map((mirror) =>
    shapes.map((step, index): Stage => {
      const { gray, t, occupied, top, height } = step;
      const mx = (x: number) => (mirror ? width - 1 - (x - left) : x - left);
      const filled = Array<number>(height).fill(0);
      for (const [x, y] of gray) filled[y - top] |= 1 << mx(x);
      const empty = Array<number>(height).fill(0);
      for (const [x, y] of [...step.empty, ...t]) empty[y - top] |= 1 << mx(x);
      return {
        name: `${definition.name} / ${states[index].name}`,
        filled,
        empty,
        t: t.map(([x, y]) => [mx(x), y - top]),
        spin: 'full',
        rows: [...new Set(t.map(([, y]) => y - top))].sort((a, b) => a - b),
        left: Math.min(...occupied.map(([x]) => mx(x))),
        top,
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

// 固定ブロックと、入口・内部のTミノ用の空間を照合する。
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
  const placed = cells(player.active!);
  for (const [x, y] of placed) before[y + HIDDEN] &= ~(1 << x);
  const after = [
    ...Array<number>(cleared.length).fill(0),
    ...fixed.filter((_, y) => !cleared.includes(y)),
  ];
  const available =
    templates === compiledTemplates ? byId : new Map(templates.map((t) => [t.id, t]));
  // 発火時は保存件数の上限に依存せず、消去前の型を再確認する。
  const candidates = [
    ...(player.templateProgress ?? []).filter((p) => p.step > 0),
    ...(cleared.length ? detectTemplateShapes(before, templates) : []),
  ];
  const next: TemplateProgress[] = [];
  let completed: string | undefined;
  for (const p of candidates) {
    const template = available.get(p.id);
    if (!template) continue;
    const stages = template.variants[p.variant];
    const stage = stages[p.step];
    if (!matches(before, stage, p.x, p.y)) continue;
    const correctClear =
      player.active!.type === 'T' &&
      spin === stage.spin &&
      cleared.length === stage.rows.length &&
      stage.rows.every((row, i) => row + p.y === cleared[i]) &&
      stage.t.every(([x, y]) =>
        placed.some(([tx, ty]) => tx === p.x + x && ty + HIDDEN === p.y + y),
      );
    if (correctClear && p.step === stages.length - 1) {
      completed ??= template.id;
      continue;
    }
    if (correctClear) {
      // JSON内の各状態の座標差を使い、消去後の同じ型の次状態を確認する。
      const following = stages[p.step + 1];
      const y = p.y + following.top - stage.top;
      if (matches(after, following, p.x, y)) next.push({ ...p, y, step: p.step + 1 });
    } else {
      const y = shiftRow(p.y, cleared);
      if (
        y !== null &&
        p.step > 0 &&
        !cleared.some((row) => row >= p.y && row < p.y + stage.filled.length) &&
        matches(after, stage, p.x, y)
      ) {
        // 型の外側の消去は解除せず、行のずれを補正して同じ段階を保持する。
        next.push({ ...p, y });
      }
    }
  }
  // 新しく組まれた型や、別の行の消去で移動した初期形を毎設置後に再検知する。
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
