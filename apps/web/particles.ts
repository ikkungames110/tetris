import type { ClearEffect, Cell } from '../../packages/core/types';
import { COLORS } from './render';

type Fragment = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  born: number;
  life: number;
};

// A separate transparent canvas lets the settled board retain its render cache.
// No per-fragment DOM nodes, shadows, physics timers or network animation frames.
export class ClearParticles {
  private fragments: Fragment[] = [];
  private lastPiece = 0;
  private dirty = false;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private canvas: HTMLCanvasElement) {}

  reset(): void {
    this.fragments = [];
    this.lastPiece = 0;
    if (this.dirty)
      this.canvas.getContext('2d')!.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = false;
  }

  update(effect: ClearEffect | undefined, now: number, tick: number): void {
    if (effect && effect.piece > this.lastPiece) {
      this.lastPiece = effect.piece;
      if (!this.reducedMotion.matches && tick - effect.tick <= 45) this.emit(effect, now);
    }
    if (!this.dirty) return;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.fragments = this.reducedMotion.matches
      ? []
      : this.fragments.filter((p) => now - p.born < p.life);
    for (const p of this.fragments) {
      const age = (now - p.born) / p.life;
      const seconds = (now - p.born) / 1000;
      const size = p.size * (1 - age * 0.75);
      ctx.globalAlpha = 0.72 * (1 - age) ** 2;
      ctx.fillStyle = p.color;
      ctx.fillRect(
        p.x + p.vx * seconds - size / 2,
        p.y + p.vy * seconds + 140 * seconds * seconds - size / 2,
        size,
        size,
      );
    }
    ctx.globalAlpha = 1;
    this.dirty = this.fragments.length > 0;
  }

  private emit(effect: ClearEffect, now: number): void {
    const cell = this.canvas.width / 10;
    for (const row of effect.rows)
      for (let x = 0; x < 10; x++) {
        const color = COLORS[row.cells[x] as NonNullable<Cell>];
        for (let part = 0; part < 4; part++) {
          // Stable visual scatter, independent of the game's random generators.
          const n = (effect.piece * 97 + row.y * 31 + x * 17 + part * 53) % 101;
          this.fragments.push({
            x: (x + (part % 2) * 0.5 + 0.25) * cell,
            y: (row.y + Math.floor(part / 2) * 0.5 + 0.25) * cell,
            vx: (x - 4.5) * 13 + ((n % 29) - 14) * 3,
            vy: -75 - n,
            size: cell * 0.42,
            color,
            born: now,
            life: 520 + n * 1.5,
          });
        }
      }
    // Bound rapid multi-clears to two simultaneous Tetris bursts per board.
    this.fragments = this.fragments.slice(-320);
    this.dirty = this.fragments.length > 0;
  }
}
