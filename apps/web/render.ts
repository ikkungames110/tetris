import { cells, HEIGHT, HIDDEN, landing, shape, WIDTH } from '../../packages/core/pieces';
import type { Cell, Match, Piece, Player, Point } from '../../packages/core/types';
import { templateName } from '../../packages/core/templates';
import { getSkin } from './skins';
import { paintSurface } from './piece-surface';
import { COLORS, appearanceKey, getTransparency } from './palette';
export { COLORS } from './palette';

// 20行のプレイ領域に加え、出現位置の上側を半マス見せる。
export const BOARD_TOP = 0.5;
export const BOARD_ROWS = HEIGHT + BOARD_TOP;

function drawMino(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  size: number,
  type: NonNullable<Cell>,
): void {
  ctx.save();
  ctx.globalAlpha *= 1 - getTransparency() / 100;
  paintSurface(ctx, points, size, COLORS[type]);
  ctx.restore();
}

// Landing rails show the lowest occupied cell in each column, without filling
// or outlining the projected piece. The shape above remains visually distinct.
function drawLanding(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  size: number,
  type: Piece,
): void {
  const floor = new Map<number, number>();
  for (const [x, y] of points) floor.set(x, Math.max(floor.get(x) ?? -Infinity, y + 1));
  ctx.save();
  ctx.strokeStyle = COLORS[type];
  ctx.lineWidth = Math.max(1.5, size * 0.065);
  ctx.lineCap = 'round';
  ctx.shadowColor = COLORS[type];
  ctx.shadowBlur = size * 0.18;
  ctx.beginPath();
  for (const [x, y] of floor) {
    const left = (x + 0.13) * size;
    const right = (x + 0.87) * size;
    const bottom = y * size - 2;
    ctx.moveTo(left, bottom - size * 0.13);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.lineTo(right, bottom - size * 0.13);
  }
  ctx.stroke();
  ctx.restore();
}

const boardFrames = new WeakMap<HTMLCanvasElement, string>();
const previewFrames = new WeakMap<HTMLCanvasElement, string>();

export function previewQueue(player: Player, countdown: boolean): readonly Piece[] {
  return countdown && player.active
    ? [player.active.type, ...player.next].slice(0, 5)
    : player.next;
}

export function drawBoard(
  canvas: HTMLCanvasElement,
  player: Player,
  countdown = false,
  riseOffset = 0,
): void {
  const active = countdown ? null : player.active;
  const key =
    `${getSkin()}:${appearanceKey()}:${canvas.width}:${canvas.height}:${riseOffset}:${player.dead}:${active?.type}:${active?.x}:${active?.y}:${active?.rotation}:` +
    player.board.map((row) => row.map((cell) => cell ?? '.').join('')).join('');
  if (boardFrames.get(canvas) === key) return;
  boardFrames.set(canvas, key);
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width / WIDTH;
  const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, '#14232c');
  background.addColorStop(0.5, '#101b25');
  background.addColorStop(1, '#17232b');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Quiet vertical guides and intersection dots keep the field measurable.
  ctx.strokeStyle = '#b2ddd009';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < WIDTH; x++) {
    ctx.moveTo(x * size + 0.5, 0);
    ctx.lineTo(x * size + 0.5, canvas.height);
  }
  ctx.stroke();
  ctx.fillStyle = '#c3ddd018';
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 1; x < WIDTH; x++) ctx.fillRect(x * size, (y + BOARD_TOP) * size, 1, 1);
  const groups = new Map<NonNullable<Cell>, Point[]>();
  for (let y = Math.max(-HIDDEN, -Math.ceil(BOARD_TOP + riseOffset)); y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const type = player.board[y + HIDDEN][x];
      if (!type) continue;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type)!.push([x, y]);
    }
  ctx.save();
  ctx.translate(0, (BOARD_TOP + riseOffset) * size);
  for (const [type, points] of groups) drawMino(ctx, points, size, type);
  ctx.restore();
  if (active && !player.dead) {
    const ghost = landing(player.board, active);
    ctx.save();
    ctx.translate(0, BOARD_TOP * size);
    drawLanding(ctx, cells(ghost), size, ghost.type);
    drawMino(ctx, cells(active), size, active.type);
    ctx.restore();
  }
}

export function drawPreview(
  canvas: HTMLCanvasElement,
  pieces: readonly Piece[],
  disabled = false,
): void {
  const key = `${getSkin()}:${appearanceKey()}:${canvas.width}:${canvas.height}:${disabled}:${pieces.join('')}`;
  if (previewFrames.get(canvas) === key) return;
  previewFrames.set(canvas, key);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const queue = canvas.dataset.preview === 'queue';
  const count = queue ? 5 : 1;
  const firstWidth = queue ? canvas.width * 0.26 : canvas.width;
  const laterWidth = (canvas.width - firstWidth) / 4;
  pieces.slice(0, count).forEach((piece, i) => {
    const points = shape(piece);
    const minX = Math.min(...points.map((p) => p[0]));
    const maxX = Math.max(...points.map((p) => p[0]));
    const minY = Math.min(...points.map((p) => p[1]));
    const maxY = Math.max(...points.map((p) => p[1]));
    const slot = i === 0 ? firstWidth : laterWidth;
    const size = Math.min((slot - 8) / 4, canvas.height / 3, i === 0 ? 19 : 14);
    const start = i === 0 ? 0 : firstWidth + (i - 1) * laterWidth;
    ctx.save();
    ctx.translate(
      start + (slot - (maxX - minX + 1) * size) / 2 - minX * size,
      (canvas.height - (maxY - minY + 1) * size) / 2 - minY * size,
    );
    ctx.globalAlpha = disabled ? 0.28 : i === 0 ? 1 : 0.8;
    drawMino(ctx, points, size, piece);
    ctx.restore();
  });
}

export function clearLabel(player: Player, tick: number): string {
  const clear = player.lastClear;
  if (!clear || tick - player.lastClearTick > 150) return '';
  if (clear.perfect) return 'PERFECT CLEAR';
  const name = templateName(clear.template);
  if (name) return name;
  if (clear.lines === 4) return '4LINES';
  if (clear.spin === 'none') return '';
  if (clear.spin === 'mini') return 'T spin mini';
  const lines = ['', 'SINGLE', 'DOUBLE', 'TRIPLE'][clear.lines] ?? '';
  return `T-SPIN ${lines}`.trim();
}

export function timeLabel(ticks: number, precise = false): string {
  const seconds = Math.floor(ticks / 60);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}${
    precise
      ? `.${Math.floor(((ticks % 60) * 1000) / 60)
          .toString()
          .padStart(3, '0')}`
      : ''
  }`;
}

export function playerSummary(match: Match, i: number): string {
  const stats = match.players[i].stats;
  return `${stats.pieces}ミノ · ${stats.lines}ライン · 攻撃${stats.sent}ライン`;
}
