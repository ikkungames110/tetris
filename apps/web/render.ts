import { cells, HEIGHT, HIDDEN, landing, shape, WIDTH } from '../../packages/core/pieces';
import type { Cell, Match, Piece, Player } from '../../packages/core/types';
import { getSkin, skinTile } from './skins';

export const COLORS: Record<NonNullable<Cell>, string> = {
  I: '#60d7e9',
  J: '#7496f5',
  L: '#efac68',
  O: '#ead773',
  S: '#b7e77f',
  T: '#b49aec',
  Z: '#ef8490',
  G: '#8392a6',
};

function tile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  type: NonNullable<Cell>,
  ghost = false,
): void {
  const color = COLORS[type];
  const gap = 1.5;
  const left = x * size + gap;
  const top = y * size + gap;
  const width = size - gap * 2;
  if (ghost) {
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = color;
    ctx.fillRect(left, top, width, width);
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, width - 1, width - 1);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.drawImage(skinTile(color, size), x * size, y * size, size, size);
}

const boardFrames = new WeakMap<HTMLCanvasElement, string>();
const previewFrames = new WeakMap<HTMLCanvasElement, string>();

export function drawBoard(canvas: HTMLCanvasElement, player: Player): void {
  const active = player.active;
  const key =
    `${getSkin()}:${canvas.width}:${canvas.height}:${player.dead}:${active?.type}:${active?.x}:${active?.y}:${active?.rotation}:` +
    player.board.map((row) => row.map((cell) => cell ?? '.').join('')).join('');
  if (boardFrames.get(canvas) === key) return;
  boardFrames.set(canvas, key);
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width / WIDTH;
  ctx.fillStyle = '#0b111a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#202b393d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < WIDTH; x++) {
    ctx.moveTo(x * size + 0.5, 0);
    ctx.lineTo(x * size + 0.5, canvas.height);
  }
  for (let y = 1; y < HEIGHT; y++) {
    ctx.moveTo(0, y * size + 0.5);
    ctx.lineTo(canvas.width, y * size + 0.5);
  }
  ctx.stroke();
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const type = player.board[y + HIDDEN][x];
      if (type) tile(ctx, x, y, size, type);
    }
  if (player.active && !player.dead) {
    const ghost = landing(player.board, player.active);
    for (const [x, y] of cells(ghost)) if (y >= 0) tile(ctx, x, y, size, ghost.type, true);
    for (const [x, y] of cells(player.active))
      if (y >= 0) tile(ctx, x, y, size, player.active.type);
  }
  // Warning line marks the visible ceiling, not an extra row of occupied cells.
  if (player.board.slice(0, HIDDEN + 5).some((row) => row.some(Boolean))) {
    ctx.strokeStyle = '#ee8290';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(canvas.width, 2);
    ctx.stroke();
  }
}

export function drawPreview(
  canvas: HTMLCanvasElement,
  pieces: readonly Piece[],
  disabled = false,
): void {
  const key = `${getSkin()}:${canvas.width}:${canvas.height}:${disabled}:${pieces.join('')}`;
  if (previewFrames.get(canvas) === key) return;
  previewFrames.set(canvas, key);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const size = 15;
  pieces.forEach((piece, i) => {
    const points = shape(piece);
    const minX = Math.min(...points.map((p) => p[0]));
    const maxX = Math.max(...points.map((p) => p[0]));
    const minY = Math.min(...points.map((p) => p[1]));
    ctx.save();
    ctx.translate(
      (canvas.width - (maxX - minX + 1) * size) / 2 - minX * size,
      i * 57 + 12 - minY * size,
    );
    ctx.globalAlpha = disabled ? 0.28 : i === 0 ? 1 : 0.65;
    for (const [x, y] of points) tile(ctx, x, y, size, piece);
    ctx.restore();
  });
}

export function clearLabel(player: Player, tick: number): string {
  const clear = player.lastClear;
  if (!clear || clear.spin === 'none' || tick - player.lastClearTick > 150) return '';
  const lines = ['', 'SINGLE', 'DOUBLE', 'TRIPLE'][clear.lines] ?? '';
  return `T-SPIN ${clear.spin === 'mini' ? 'MINI ' : ''}${lines}`.trim();
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
