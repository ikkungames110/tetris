import type { Cell, Point } from '../../packages/core/types';
import { getSkin } from './skins';
import { COLORS } from './palette';

export const usesSilhouette = (): boolean => ['neon', 'texture', 'pattern'].includes(getSkin());

// Shared edges never enter the outline, so a mino reads as one continuous shape.
export function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  size: number,
  type: NonNullable<Cell>,
  ghost = false,
): void {
  if (!points.length) return;
  const skin = getSkin();
  const color = COLORS[type];
  const occupied = new Set(points.map(([x, y]) => `${x},${y}`));
  // Trace only exposed edges. At diagonal contacts, turn right to keep the
  // outlines separate; opposite winding preserves holes inside settled stacks.
  type Edge = { start: Point; end: Point; direction: number };
  const edges = new Set<Edge>();
  const outgoing = new Map<string, Edge[]>();
  for (const [x, y] of points) {
    const sides = [
      [0, -1, x, y, x + 1, y],
      [1, 0, x + 1, y, x + 1, y + 1],
      [0, 1, x + 1, y + 1, x, y + 1],
      [-1, 0, x, y + 1, x, y],
    ];
    sides.forEach(([dx, dy, ax, ay, bx, by], direction) => {
      if (occupied.has(`${x + dx},${y + dy}`)) return;
      const edge: Edge = { start: [ax, ay], end: [bx, by], direction };
      edges.add(edge);
      const key = `${ax},${ay}`;
      if (!outgoing.has(key)) outgoing.set(key, []);
      outgoing.get(key)!.push(edge);
    });
  }
  const body = new Path2D();
  while (edges.size) {
    const first = edges.values().next().value!;
    let current: Edge | undefined = first;
    const vertices: Point[] = [];
    while (current) {
      vertices.push(current.start);
      edges.delete(current);
      const [x, y] = current.end;
      if (x === first.start[0] && y === first.start[1]) break;
      const direction: number = current.direction;
      const candidates: Edge[] = (outgoing.get(`${x},${y}`) ?? []).filter((edge) =>
        edges.has(edge),
      );
      current = [1, 0, 3, 2].flatMap((turn) =>
        candidates.filter((edge) => (edge.direction - direction + 4) % 4 === turn),
      )[0];
    }
    // Drop collinear cell corners so a long edge has no seams or bright dots.
    const corners = vertices.filter(([x, y], i) => {
      const prev = vertices[(i + vertices.length - 1) % vertices.length];
      const next = vertices[(i + 1) % vertices.length];
      return (x - prev[0]) * (next[1] - y) !== (y - prev[1]) * (next[0] - x);
    });
    const radius = size * 0.14;
    corners.forEach(([x, y], i) => {
      const prev = corners[(i + corners.length - 1) % corners.length];
      const next = corners[(i + 1) % corners.length];
      const ax = x * size + Math.sign(prev[0] - x) * radius;
      const ay = y * size + Math.sign(prev[1] - y) * radius;
      if (i === 0) body.moveTo(ax, ay);
      else body.lineTo(ax, ay);
      body.quadraticCurveTo(
        x * size,
        y * size,
        x * size + Math.sign(next[0] - x) * radius,
        y * size + Math.sign(next[1] - y) * radius,
      );
    });
    body.closePath();
  }
  const edge = body;
  ctx.save();
  if (ghost) {
    ctx.fillStyle = `${color}18`;
    ctx.fill(body);
    ctx.strokeStyle = `${color}aa`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke(edge);
    ctx.restore();
    return;
  }
  ctx.fillStyle = skin === 'neon' ? `${color}28` : skin === 'pattern' ? `${color}65` : color;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  const left = Math.min(...points.map(([x]) => x)) * size;
  const top = Math.min(...points.map(([, y]) => y)) * size;
  const right = (Math.max(...points.map(([x]) => x)) + 1) * size;
  const bottom = (Math.max(...points.map(([, y]) => y)) + 1) * size;
  ctx.lineWidth = Math.max(1, size * 0.08);
  if (skin === 'texture') {
    if (type === 'L' || type === 'J') {
      // Amber wood grain and blue ripples flow across cell boundaries.
      for (let y = top - size; y < bottom + size; y += size * 0.19) {
        ctx.beginPath();
        for (let x = left; x <= right; x += 2) {
          const py = y + Math.sin((x - left) / (size * 0.6) + y / size) * size * 0.15;
          if (x === left) ctx.moveTo(x, py);
          else ctx.lineTo(x, py);
        }
        ctx.strokeStyle = Math.round((y - top) / (size * 0.19)) % 2 ? '#ffffff35' : '#00000025';
        ctx.stroke();
      }
    } else {
      // Fixed triangular facets: stable while moving, without random per-frame noise.
      const step = size * 0.5;
      for (let y = top, row = 0; y < bottom; y += step, row++) {
        for (let x = left, col = 0; x < right; x += step, col++) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + step, y);
          ctx.lineTo(x + (row % 2 ? 0 : step), y + step);
          ctx.closePath();
          ctx.fillStyle = ['#ffffff38', '#00000018', '#ffffff12', '#00000030'][(row * 3 + col) % 4];
          ctx.fill();
        }
      }
    }
  } else if (skin === 'pattern') {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    if (type === 'O') {
      const cx = (left + right) / 2,
        cy = (top + bottom) / 2;
      for (const radius of [size * 0.24, size * 0.7]) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (type === 'T') {
      for (const [x, y] of points) {
        const cx = (x + 0.5) * size,
          cy = (y + 0.5) * size;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.09, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ]) {
          if (!occupied.has(`${x + dx},${y + dy}`)) continue;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + dx * size, cy + dy * size);
          ctx.stroke();
        }
      }
    } else if (type === 'I' || type === 'J') {
      for (let y = top + size * 0.45; y < bottom; y += size * 0.65) {
        ctx.beginPath();
        for (let x = left + size * 0.2; x <= right - size * 0.2; x++) {
          const py = y + Math.sin(((x - left) / size) * Math.PI * 2) * size * 0.1;
          if (x === left + size * 0.2) ctx.moveTo(x, py);
          else ctx.lineTo(x, py);
        }
        ctx.stroke();
      }
    } else {
      for (let x = left - (bottom - top); x < right + bottom - top; x += size * 0.3) {
        const direction = type === 'Z' ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x + direction * (bottom - top), bottom);
        ctx.stroke();
      }
    }
  }
  // An inset dark rim separates touching colors without subdividing the mino.
  ctx.strokeStyle = '#0b111a';
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.stroke(edge);
  ctx.restore();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.055);
  if (skin === 'neon') {
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.3;
    ctx.stroke(edge);
    ctx.shadowBlur = size * 0.12;
    ctx.strokeStyle = '#edffff';
    ctx.lineWidth = Math.max(0.7, size * 0.03);
  }
  ctx.stroke(edge);
  ctx.restore();
}
