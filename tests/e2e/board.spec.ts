import { expect, test, type Page } from '@playwright/test';

async function pieceColors(page: Page, selector: string, height?: number): Promise<string[]> {
  return page.locator(selector).evaluate((element, height) => {
    const canvas = element as HTMLCanvasElement;
    const colors = new Set(['60d7e9', '7496f5', 'efac68', 'ead773', 'b7e77f', 'b49aec', 'ef8490']);
    const found = new Set<string>();
    const pixels = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, height ?? canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      const color = Array.from(pixels.slice(i, i + 3), (c) => c.toString(16).padStart(2, '0')).join(
        '',
      );
      if (colors.has(color) && pixels[i + 3] === 255) found.add(color);
    }
    return [...found];
  }, height);
}

for (const mode of ['sprint']) {
  test(`${mode}: カウント中は空の盤面で、NEXT先頭が最初に出現する`, async ({ page }) => {
    await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
    await page.goto('/');
    await page.locator(`#${mode}`).click();
    const board = page.locator('#board-0');
    await expect(board).toHaveAttribute('height', '615');
    const blank = await board.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    expect(await pieceColors(page, '#board-0')).toEqual([]);
    await page.locator('#start').click();
    const first = await pieceColors(page, '#next-0', 57);
    expect(first).toHaveLength(1);
    const queue = await page
      .locator('#next-0')
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    for (const count of ['3', '2', '1']) {
      await expect(page.locator('#board-overlay-0 > span')).toHaveText(count);
      expect(await board.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(blank);
      expect(
        await page.locator('#next-0').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
      ).toBe(queue);
    }
    await expect(page.locator('#board-overlay-0')).toBeHidden();
    expect(await pieceColors(page, '#board-0')).toEqual(first);
    expect(
      await page.locator('#next-0').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    ).not.toBe(queue);
    const box = (await board.boundingBox())!;
    expect(box.height / box.width).toBeCloseTo(2.05, 2);
    await page.screenshot({ path: `test-results/board-spawn-${mode}.png` });
  });
}

test('全7種の出現形状が上端の半マスにも描画され、固定ブロックは最下段まで揃う', async ({
  page,
}) => {
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const renderPath = '/apps/web/render.ts';
    const enginePath = '/packages/core/engine.ts';
    const { drawBoard, COLORS } = await import(renderPath);
    const { createPlayer } = await import(enginePath);
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 615;
    const ctx = canvas.getContext('2d')!;
    const colored = (x: number, y: number, color: string) => {
      const rgb = [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
      return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}` === color;
    };
    const masks = Object.fromEntries(
      ['I', 'J', 'L', 'O', 'S', 'T', 'Z'].map((type) => {
        const player = createPlayer(42, 43);
        player.active = { type, x: 3, y: -1, rotation: 0 };
        drawBoard(canvas, player);
        return [
          type,
          [7, 30].map((y) =>
            Array.from({ length: 4 }, (_, x) =>
              colored((x + 3) * 30 + 15, y, COLORS[type]) ? 'X' : '.',
            ).join(''),
          ),
        ];
      }),
    );
    const player = createPlayer(42, 43);
    player.active = null;
    player.board[19][0] = 'J';
    player.board[39][9] = 'L';
    drawBoard(canvas, player);
    return {
      masks,
      upperFixed: colored(15, 7, COLORS.J),
      bottomFixed: colored(285, 600, COLORS.L),
    };
  });
  expect(result).toEqual({
    masks: {
      I: ['....', 'XXXX'],
      J: ['X...', 'XXX.'],
      L: ['..X.', 'XXX.'],
      O: ['.XX.', '.XX.'],
      S: ['.XX.', 'XX..'],
      T: ['.X..', 'XXX.'],
      Z: ['XX..', '.XX.'],
    },
    upperFixed: true,
    bottomFixed: true,
  });
});
