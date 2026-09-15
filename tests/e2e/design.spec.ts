import { expect, test } from '@playwright/test';

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [844, 390],
  [1440, 1000],
]) {
  test(`STOCK / QUEUE are above the field and touch targets remain usable: ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const board = (await page.locator('#board-0').boundingBox())!;
    const stock = (await page.locator('#hold-0').boundingBox())!;
    const queue = (await page.locator('#next-0').boundingBox())!;
    expect(stock.y + stock.height).toBeLessThan(board.y);
    expect(queue.y + queue.height).toBeLessThan(board.y);
    expect(stock.x + stock.width).toBeLessThan(queue.x);
    expect(queue.width).toBeGreaterThan(queue.height * 4);
    expect(queue.x + queue.width).toBeLessThanOrEqual(width);
    expect(stock.x).toBeGreaterThanOrEqual(0);
    if (width < 600) {
      expect(board.height).toBeGreaterThan(height < 700 ? 220 : 400);
      for (const button of await page.locator('.touch-key').all()) {
        const box = (await button.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.y).toBeGreaterThanOrEqual(board.y + board.height);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('all seven shapes retain their occupied cells in every rotation; only landing rails appear at the destination', async ({
  page,
}) => {
  await page.goto('/');
  const samples = await page.evaluate(async () => {
    const renderPath = '/apps/web/render.ts';
    const enginePath = '/packages/core/engine.ts';
    const piecesPath = '/packages/core/pieces.ts';
    const { drawBoard, BOARD_TOP, COLORS } = await import(renderPath);
    const { createPlayer } = await import(enginePath);
    const { cells, landing } = await import(piecesPath);
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 615;
    const ctx = canvas.getContext('2d')!;
    const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    const result = [];
    for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L']) {
      for (const rotation of [0, 1, 2, 3]) {
        for (const raised of [false, true]) {
          const player = createPlayer(42, 43);
          player.active = null;
          if (raised) {
            // Uneven stack exercises stepped destinations, including overhangs.
            player.board[39][4] = 'G';
            player.board[38][4] = 'G';
          }
          drawBoard(canvas, player);
          const blank = ctx.getImageData(0, 0, 300, 615).data;
          player.active = { type, rotation, x: 3, y: 2 };
          drawBoard(canvas, player);
          const points = cells(player.active);
          const centers = points.map(([x, y]: number[]) =>
            pixel(x * 30 + 15, (y + BOARD_TOP) * 30 + 15),
          );
          const destination = cells(landing(player.board, player.active));
          const clearCenters = destination.every(([x, y]: number[]) => {
            const px = x * 30 + 15,
              py = (y + BOARD_TOP) * 30 + 15;
            return pixel(px, py).every((v, c) => v === blank[(py * 300 + px) * 4 + c]);
          });
          const floors = new Map<number, number>();
          for (const [x, y] of destination) floors.set(x, Math.max(floors.get(x) ?? 0, y));
          const rails = [...floors].every(([x, y]) => {
            const px = x * 30 + 15,
              py = (y + BOARD_TOP + 1) * 30 - 2;
            return pixel(px, py).some((v, c) => v !== blank[(py * 300 + px) * 4 + c]);
          });
          result.push({
            type,
            rotation,
            raised,
            centers,
            color: COLORS[type],
            clearCenters,
            rails,
          });
        }
      }
    }
    return result;
  });
  for (const sample of samples) {
    const rgb = sample.color
      .slice(1)
      .match(/../g)!
      .map((v: string) => parseInt(v, 16));
    expect(sample.centers).toEqual(Array.from({ length: 4 }, () => [...rgb, 255]));
    expect(sample.clearCenters, JSON.stringify(sample)).toBe(true);
    expect(sample.rails, JSON.stringify(sample)).toBe(true);
  }
});
