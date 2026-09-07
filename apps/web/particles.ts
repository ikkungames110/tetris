import type { ClearEffect, Cell } from '../../packages/core/types';
import { BOARD_TOP, COLORS } from './render';

type Fragment = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
  sprite: HTMLCanvasElement;
  born: number;
  life: number;
};

const lights = new Map<string, HTMLCanvasElement>();
function light(color: string, star: boolean): HTMLCanvasElement {
  const key = `${color}:${star}`;
  const cached = lights.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, '#ffffffef');
  glow.addColorStop(0.08, '#efffffda');
  glow.addColorStop(0.23, `${color}91`);
  glow.addColorStop(0.5, `${color}25`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 32, 32);
  if (star) {
    ctx.fillStyle = '#efffffb0';
    ctx.beginPath();
    for (const [i, x, y] of [
      [0, 16, 3],
      [1, 18, 14],
      [2, 29, 16],
      [3, 18, 18],
      [4, 16, 29],
      [5, 14, 18],
      [6, 3, 16],
      [7, 14, 14],
    ])
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    ctx.closePath();
    ctx.fill();
  }
  lights.set(key, canvas);
  return canvas;
}

// A separate transparent canvas preserves the settled board's render cache.
// Glow sprites are baked once: no per-particle shadows, gradients or DOM nodes.
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
    ctx.globalCompositeOperation = 'screen';
    for (const p of this.fragments) {
      const age = (now - p.born) / p.life;
      const seconds = (now - p.born) / 1000;
      const size = p.size * (1 - age * 0.45);
      const drift = Math.sin(age * 4 + p.phase) - Math.sin(p.phase);
      const x = p.x + p.vx * seconds + drift * 9;
      const y = p.y + p.vy * seconds - 16 * seconds * seconds;
      const shimmer = 0.72 + 0.28 * Math.sin(age * 12 + p.phase) ** 2;
      ctx.globalAlpha = 0.8 * (1 - age) ** 1.6 * shimmer;
      ctx.drawImage(p.sprite, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.dirty = this.fragments.length > 0;
  }

  private emit(effect: ClearEffect, now: number): void {
    const cell = this.canvas.width / 10;
    for (const row of effect.rows)
      for (let x = 0; x < 10; x++) {
        const color = COLORS[row.cells[x] as NonNullable<Cell>];
        if (!color) continue;
        for (let part = 0; part < 12; part++) {
          // Stable visual scatter, independent of the game's random generators.
          const n = (effect.piece * 97 + row.y * 31 + x * 17 + part * 53) % 101;
          const star = part === 0 || part === 7;
          this.fragments.push({
            x: (x + ((part % 4) + 0.2 + (n % 7) / 12) / 4) * cell,
            y: (row.y + BOARD_TOP + (Math.floor(part / 4) + 0.2 + (n % 5) / 10) / 3) * cell,
            vx: (x - 4.5) * 5 + ((n % 23) - 11) * 2,
            vy: -22 - (n % 51),
            // Most of the sprite is a soft halo; the bright core is 1–2 pixels.
            size: cell * (star ? 0.45 : 0.17 + (n % 11) / 90),
            phase: n * 0.37,
            sprite: light(color, star),
            born: now,
            life: 680 + n * 4,
          });
        }
      }
    this.fragments = this.fragments.slice(-960);
    this.dirty = this.fragments.length > 0;
  }
}
