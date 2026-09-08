import { HIDDEN } from '../../packages/core/pieces';
import { boardMasks, detectTemplateShapes, templateStage } from '../../packages/core/templates';
import type { Player } from '../../packages/core/types';

export class TemplateDebug {
  message = '未検知';
  private previous: (number[] | undefined)[] = [];
  private found: Set<string>[] = [];
  private progress: string[] = [];

  reset(): void {
    this.message = '未検知';
    this.previous = [];
    this.found = [];
    this.progress = [];
  }

  update(player: Pick<Player, 'board' | 'templateProgress'>, seat: number): void {
    const masks = boardMasks(player.board);
    const previous = this.previous[seat];
    // オンラインの盤面コピーでも、内容が同じなら型の走査を繰り返さない。
    const progress = JSON.stringify(player.templateProgress);
    if (
      previous &&
      masks.every((row, y) => row === previous[y]) &&
      this.progress[seat] === progress
    )
      return;
    this.progress[seat] = progress;
    this.previous[seat] = masks;
    const shapes = [
      ...detectTemplateShapes(masks),
      ...(player.templateProgress ?? []).filter((p) => p.step > 0),
    ];
    const keys = new Set<string>();
    for (const shape of shapes) {
      const key = `${shape.id}:${shape.variant}:${shape.x}:${shape.y}:${shape.step}`;
      keys.add(key);
      if (!this.found[seat]?.has(key))
        this.message = `${templateStage(shape).name} 検知（${seat + 1}P・左${shape.x + templateStage(shape).left + 1}列目・上${shape.y - HIDDEN + 1}行目${shape.variant ? '・左右反転' : ''}）`;
    }
    this.found[seat] = keys;
  }
}
