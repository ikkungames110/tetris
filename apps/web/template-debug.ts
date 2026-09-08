import { HIDDEN } from '../../packages/core/pieces';
import { boardMasks, detectTemplateShapes, templateName } from '../../packages/core/templates';
import type { Cell } from '../../packages/core/types';

export class TemplateDebug {
  message = '未検知';
  private previous: (number[] | undefined)[] = [];
  private found: Set<string>[] = [];

  reset(): void {
    this.message = '未検知';
    this.previous = [];
    this.found = [];
  }

  update(board: Cell[][], seat: number): void {
    const masks = boardMasks(board);
    const previous = this.previous[seat];
    // オンラインの盤面コピーでも、内容が同じなら型の走査を繰り返さない。
    if (previous && masks.every((row, y) => row === previous[y])) return;
    this.previous[seat] = masks;
    const shapes = detectTemplateShapes(masks);
    const keys = new Set<string>();
    for (const shape of shapes) {
      const key = `${shape.id}:${shape.variant}:${shape.x}:${shape.y}`;
      keys.add(key);
      if (!this.found[seat]?.has(key))
        this.message = `${templateName(shape.id)} 検知（${seat + 1}P・左${shape.x + 1}列目・上${shape.y - HIDDEN + 1}行目${shape.variant ? '・左右反転' : ''}）`;
    }
    this.found[seat] = keys;
  }
}
