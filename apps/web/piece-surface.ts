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
  if (skin !== 'classic') {
    const sheen = ctx.createLinearGradient(left, top, right, bottom);
    sheen.addColorStop(0, '#ffffff38');
    sheen.addColorStop(skin === 'metal' ? 0.48 : 0.65, '#00000038');
    sheen.addColorStop(1, skin === 'neon' ? '#00000088' : '#ffffff18');
    ctx.fillStyle = sheen;
    ctx.fillRect(left, top, right - left, bottom - top);
    if (skin === 'pattern' || skin === 'texture') {
      ctx.strokeStyle = '#ffffff25';
      ctx.lineWidth = skin === 'texture' ? 0.6 : 1.2;
      const step = size * (skin === 'texture' ? 0.16 : 0.6);
      ctx.beginPath();
      for (let x = left - (bottom - top); x < right; x += step) {
        ctx.moveTo(x, top);
        ctx.lineTo(x + bottom - top, bottom);
      }
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#00000060';
  ctx.lineWidth = Math.max(1.5, size * 0.075);
  ctx.stroke(path);
  ctx.translate(0, Math.max(0.7, size * 0.035));
  ctx.strokeStyle = '#ffffff55';
  ctx.lineWidth = Math.max(0.6, size * 0.025);
  ctx.stroke(path);
  ctx.restore();
}
