export type Skin = 'classic' | 'crystal' | 'metal';
const storageKey = 'tetcla-skin';
const validSkin = (value: unknown): value is Skin =>
  value === 'classic' || value === 'crystal' || value === 'metal';

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
export function skinTile(color: string, size: number): HTMLCanvasElement {
  const key = `${selected}:${color}:${size}`;
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

  if (selected === 'crystal') {
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
  tiles.set(key, canvas);
  return canvas;
}
