import type { Cell } from '../../packages/core/types';
export type Skin = 'classic' | 'crystal' | 'metal' | 'neon' | 'texture' | 'pattern';
const storageKey = 'tetcla-skin';
const validSkin = (value: unknown): value is Skin =>
  value === 'classic' ||
  value === 'crystal' ||
  value === 'metal' ||
  value === 'neon' ||
  value === 'texture' ||
  value === 'pattern';

let selected: Skin = 'classic';
try {
  const saved = localStorage.getItem(storageKey);
  if (validSkin(saved)) selected = saved;
} catch {
  // Storage can be unavailable; the selection still works for this tab.
}

export const getSkin = (): Skin => selected;
export function setSkin(value: string): void {
  if (!validSkin(value)) return;
  selected = value;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Optional persistence.
  }
}

const tiles = new Map<string, HTMLCanvasElement>();

// Bake material details once, then reuse the same sprite for board, HOLD and NEXT.
// Transparent crystal pixels preserve the board grid underneath the piece.
export function skinTile(
  color: string,
  size: number,
  type: NonNullable<Cell> = 'G',
): HTMLCanvasElement {
  const key = `${selected}:${color}:${size}:${type}`;
  const cached = tiles.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  const gap = 1.5;
  const width = size - gap * 2;
  ctx.translate(gap, gap);
  const polygon = (points: number[][], fill: string) => {
    ctx.beginPath();
    points.forEach(([x, y], i) =>
      i ? ctx.lineTo(x * width, y * width) : ctx.moveTo(x * width, y * width),
    );
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  if (selected === 'neon' || selected === 'texture' || selected === 'pattern') {
    const body = new Path2D();
    body.roundRect(0.8, 0.8, width - 1.6, width - 1.6, Math.max(1, width * 0.09));
    ctx.fillStyle =
      selected === 'neon' ? `${color}28` : selected === 'pattern' ? `${color}65` : color;
    ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    ctx.lineWidth = Math.max(0.8, width * 0.065);
    ctx.strokeStyle = color;
    if (selected === 'texture') {
      if (type === 'L' || type === 'J') {
        for (let y = 0; y < width + 3; y += width * 0.18) {
          ctx.beginPath();
          for (let x = 0; x <= width; x++) {
            const py = y + Math.sin((x / width) * 5 + y) * width * 0.1;
            if (x === 0) ctx.moveTo(x, py);
            else ctx.lineTo(x, py);
          }
          ctx.strokeStyle = '#ffffff45';
          ctx.stroke();
        }
      } else {
        for (let row = 0; row < 2; row++)
          for (let col = 0; col < 2; col++) {
            polygon(
              [
                [col / 2, row / 2],
                [(col + 1) / 2, row / 2],
                [col / 2, (row + 1) / 2],
              ],
              (row + col) % 2 ? '#00000028' : '#ffffff45',
            );
          }
      }
    } else if (selected === 'pattern') {
      ctx.lineCap = 'round';
      if (type === 'O') {
        for (const radius of [0.13, 0.32]) {
          ctx.beginPath();
          ctx.arc(width / 2, width / 2, width * radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (type === 'T') {
        ctx.beginPath();
        ctx.moveTo(width * 0.2, width * 0.7);
        ctx.lineTo(width * 0.8, width * 0.7);
        ctx.moveTo(width / 2, width * 0.7);
        ctx.lineTo(width / 2, width * 0.25);
        ctx.stroke();
        ctx.fillStyle = color;
        for (const [x, y] of [
          [0.2, 0.7],
          [0.8, 0.7],
          [0.5, 0.25],
        ]) {
          ctx.beginPath();
          ctx.arc(width * x, width * y, width * 0.065, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (type === 'I') {
        ctx.beginPath();
        for (let x = width * 0.15; x <= width * 0.85; x += 0.5) {
          const y = width * (0.5 + Math.sin((x / width - 0.15) * 9) * 0.12);
          if (x === width * 0.15) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (type === 'J') {
        for (const [x, height] of [
          [0.25, 0.3],
          [0.5, 0.6],
          [0.75, 0.45],
        ]) {
          ctx.beginPath();
          ctx.moveTo(width * x, width * 0.8);
          ctx.lineTo(width * x, width * (0.8 - height));
          ctx.stroke();
        }
      } else {
        for (let x = -width; x < width * 2; x += width * 0.27) {
          ctx.beginPath();
          ctx.moveTo(x, width * 0.2);
          ctx.lineTo(x + (type === 'Z' ? -1 : 1) * width * 0.6, width * 0.8);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    if (selected === 'neon') {
      ctx.shadowColor = color;
      ctx.shadowBlur = 3;
    }
    ctx.stroke(body);
    ctx.shadowBlur = 0;
  } else if (selected === 'crystal') {
    const glass = ctx.createLinearGradient(0, 0, width, width);
    glass.addColorStop(0, `${color}95`);
    glass.addColorStop(0.45, `${color}38`);
    glass.addColorStop(1, `${color}70`);
    ctx.fillStyle = glass;
    ctx.fillRect(0, 0, width, width);
    polygon(
      [
        [0, 0],
        [1, 0],
        [0.76, 0.23],
        [0.2, 0.2],
      ],
      '#ffffff65',
    );
    polygon(
      [
        [0, 0],
        [0.2, 0.2],
        [0.23, 0.78],
        [0, 1],
      ],
      `${color}88`,
    );
    polygon(
      [
        [1, 0],
        [1, 1],
        [0.78, 0.76],
        [0.76, 0.23],
      ],
      '#ffffff30',
    );
    polygon(
      [
        [0, 1],
        [0.23, 0.78],
        [0.78, 0.76],
        [1, 1],
      ],
      `${color}a0`,
    );
    polygon(
      [
        [0.2, 0.2],
        [0.76, 0.23],
        [0.23, 0.78],
      ],
      '#ffffff19',
    );
    polygon(
      [
        [0.18, 0.04],
        [0.37, 0.04],
        [0.04, 0.65],
        [0.04, 0.4],
      ],
      '#ffffff4a',
    );
    ctx.strokeStyle = `${color}d0`;
    ctx.lineWidth = 0.7;
    ctx.strokeRect(0.4, 0.4, width - 0.8, width - 0.8);
    ctx.strokeStyle = '#efffff8a';
    ctx.beginPath();
    ctx.moveTo(width * 0.2, width * 0.2);
    ctx.lineTo(width * 0.76, width * 0.23);
    ctx.lineTo(width * 0.78, width * 0.76);
    ctx.stroke();
    ctx.fillStyle = '#f2ffffd0';
    ctx.fillRect(0.7, 0.7, Math.max(2, width * 0.17), 0.8);
  } else if (selected === 'metal') {
    const steel = ctx.createLinearGradient(0, 0, width * 0.75, width);
    steel.addColorStop(0, '#e1e8f0');
    steel.addColorStop(0.2, '#798b9f');
    steel.addColorStop(0.43, '#26394d');
    steel.addColorStop(0.49, '#aebccb');
    steel.addColorStop(0.57, '#eef5fc');
    steel.addColorStop(0.64, '#627489');
    steel.addColorStop(1, '#1d2c3e');
    ctx.fillStyle = steel;
    ctx.fillRect(0, 0, width, width);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, width);
    ctx.globalCompositeOperation = 'source-over';
    // Fine fixed brush marks: no animated texture generation during play.
    for (let y = 2; y < width - 2; y += 1.3) {
      ctx.fillStyle = Math.floor(y * 3) % 2 ? '#ffffff12' : '#00000014';
      ctx.fillRect(2, y, width - 4, 0.35);
    }
    polygon(
      [
        [0, 0],
        [1, 0],
        [0.86, 0.14],
        [0.14, 0.14],
      ],
      '#ffffff80',
    );
    polygon(
      [
        [0, 0],
        [0.14, 0.14],
        [0.14, 0.86],
        [0, 1],
      ],
      '#ffffff2e',
    );
    polygon(
      [
        [0, 1],
        [0.14, 0.86],
        [0.86, 0.86],
        [1, 1],
      ],
      '#00000075',
    );
    polygon(
      [
        [1, 0],
        [1, 1],
        [0.86, 0.86],
        [0.86, 0.14],
      ],
      '#0000004d',
    );
    ctx.strokeStyle = '#ffffff44';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(width * 0.15, width * 0.15, width * 0.7, width * 0.7);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, width);
    ctx.fillStyle = '#ffffff55';
    ctx.fillRect(0, 0, width, 2);
    ctx.fillStyle = '#00000020';
    ctx.fillRect(0, width - 3, width, 3);
    ctx.strokeStyle = '#11172025';
    ctx.lineWidth = 1;
    ctx.strokeRect(5, 5, width - 10, width - 10);
  }
  // Bound memory while the saturation slider generates different color values.
  if (tiles.size >= 256) tiles.delete(tiles.keys().next().value!);
  tiles.set(key, canvas);
  return canvas;
}
