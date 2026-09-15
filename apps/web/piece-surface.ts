import type { Point } from '../../packages/core/types';
import { getSkin } from './skins';

// Trace only exposed edges. Shared cell edges never become visible seams.
export function connectedOutline(points: readonly Point[], size: number): Path2D {
  const occupied = new Set(points.map(([x, y]) => `${x},${y}`));
  const edges = new Map<string, { from: Point; to: Point; direction: number }[]>();
  const add = (from: Point, to: Point, direction: number) => {
    const key = from.join(',');
    const list = edges.get(key) ?? [];
    list.push({ from, to, direction });
    edges.set(key, list);
  };
  for (const [x, y] of points) {
    if (!occupied.has(`${x},${y - 1}`)) add([x, y], [x + 1, y], 0);
    if (!occupied.has(`${x + 1},${y}`)) add([x + 1, y], [x + 1, y + 1], 1);
    if (!occupied.has(`${x},${y + 1}`)) add([x + 1, y + 1], [x, y + 1], 2);
    if (!occupied.has(`${x - 1},${y}`)) add([x, y + 1], [x, y], 3);
  }
  const path = new Path2D();
  while (edges.size) {
    const start = edges.values().next().value![0];
    let edge = start;
    const loop: Point[] = [];
    do {
      loop.push(edge.from);
      const key = edge.from.join(',');
      const list = edges.get(key)!;
      list.splice(list.indexOf(edge), 1);
      if (!list.length) edges.delete(key);
      if (edge.to.join(',') === start.from.join(',')) break;
      const next = edges.get(edge.to.join(','))!;
      // Turn right at diagonal contacts so independent islands stay independent.
      edge =
        next.find((candidate) => (candidate.direction - edge.direction + 4) % 4 === 1) ?? next[0];
    } while (edge);
    const radius = size * 0.12;
    loop.forEach(([x, y], i) => {
      const prev = loop[(i + loop.length - 1) % loop.length];
      const next = loop[(i + 1) % loop.length];
      const before: Point = [x * size + (prev[0] - x) * radius, y * size + (prev[1] - y) * radius];
      const after: Point = [x * size + (next[0] - x) * radius, y * size + (next[1] - y) * radius];
      if (i === 0) path.moveTo(...before);
      else path.lineTo(...before);
      path.quadraticCurveTo(x * size, y * size, ...after);
    });
    path.closePath();
  }
  return path;
}

export function paintSurface(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  size: number,
  color: string,
): void {
  if (!points.length) return;
  const path = connectedOutline(points, size);
  const left = Math.min(...points.map(([x]) => x)) * size;
  const top = Math.min(...points.map(([, y]) => y)) * size;
  const right = (Math.max(...points.map(([x]) => x)) + 1) * size;
  const bottom = (Math.max(...points.map(([, y]) => y)) + 1) * size;
  const skin = getSkin();
  ctx.save();
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.clip(path);
  // All materials span the connected object, never individual square tiles.
  const width = right - left;
  const height = bottom - top;
  const gradient = (stops: readonly (readonly [number, string])[], vertical = false) => {
    const fill = ctx.createLinearGradient(left, top, vertical ? left : right, bottom);
    for (const [offset, shade] of stops) fill.addColorStop(offset, shade);
    ctx.fillStyle = fill;
    ctx.fillRect(left, top, width, height);
  };
  switch (skin) {
    case 'crystal':
      gradient([
        [0, '#ffffff80'],
        [0.45, '#ffffff08'],
        [1, '#00000045'],
      ]);
      // Broad translucent facets keep the silhouette readable even in previews.
      ctx.fillStyle = '#ffffff38';
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(right, top);
      ctx.lineTo(left + width * 0.28, bottom);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff20';
      ctx.beginPath();
      ctx.moveTo(right, top);
      ctx.lineTo(right, bottom);
      ctx.lineTo(left + width * 0.28, bottom);
      ctx.closePath();
      ctx.fill();
      break;
    case 'metal':
      gradient(
        [
          [0, '#ffffff65'],
          [0.3, '#00000038'],
          [0.47, '#ffffff85'],
          [0.57, '#ffffff18'],
          [0.75, '#00000065'],
          [1, '#ffffff30'],
        ],
        true,
      );
      ctx.strokeStyle = '#ffffff12';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let y = top + 1; y < bottom; y += 2) {
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.stroke();
      break;
    case 'neon':
      gradient([
        [0, '#00000040'],
        [0.5, '#00000085'],
        [1, '#00000055'],
      ]);
      // Clip the glow inside the object so it never obscures adjacent cells.
      ctx.shadowColor = color;
      ctx.shadowBlur = size * 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 0.24;
      ctx.stroke(path);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffffbb';
      ctx.lineWidth = Math.max(1, size * 0.065);
      ctx.stroke(path);
      break;
    case 'texture':
      gradient([
        [0, '#ffffff20'],
        [1, '#00000038'],
      ]);
      // Two fine crossing threads form a woven surface.
      for (const direction of [-1, 1]) {
        ctx.strokeStyle = direction === 1 ? '#ffffff28' : '#00000024';
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        for (let x = left - height; x < right + height; x += Math.max(3, size * 0.18)) {
          ctx.moveTo(x, top);
          ctx.lineTo(x + direction * height, bottom);
        }
        ctx.stroke();
      }
      break;
    case 'pattern':
      gradient([
        [0, '#ffffff20'],
        [1, '#00000030'],
      ]);
      ctx.strokeStyle = '#ffffff38';
      ctx.lineWidth = size * 0.22;
      ctx.beginPath();
      for (let x = left - height; x < right; x += size * 0.6) {
        ctx.moveTo(x, top);
        ctx.lineTo(x + height, bottom);
      }
      ctx.stroke();
      break;
  }
  ctx.strokeStyle = skin === 'neon' ? '#ffffff90' : '#00000060';
  ctx.lineWidth = Math.max(1.5, size * 0.075);
  ctx.stroke(path);
  ctx.translate(0, Math.max(0.7, size * 0.035));
  ctx.strokeStyle = '#ffffff55';
  ctx.lineWidth = Math.max(0.6, size * 0.025);
  ctx.stroke(path);
  ctx.restore();
}
