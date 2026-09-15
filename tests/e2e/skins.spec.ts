import { startSolo } from '../helpers/solo';
import { expect, test } from '@playwright/test';

test('skin changes redraw paused pieces and persist across reloads', async ({ page }) => {
  await page.addInitScript(() => {
    crypto.getRandomValues = <T extends ArrayBufferView | null>(values: T): T => {
      (values as unknown as Uint32Array).fill(42);
      return values;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'マイページ', exact: true }).click();
  await expect(page.getByLabel('スキン', { exact: true })).toHaveValue('texture');
  const next = page.locator('#next-0');
  const image = () => next.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const fiber = await image();
  await page.getByLabel('スキン', { exact: true }).selectOption('crystal');
  await expect.poll(image).not.toBe(fiber);
  const crystal = await image();
  await page.locator('#mypage-close').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mypage-dialog')).not.toBeVisible();
  await expect(page.locator('#mypage-open')).toBeFocused();
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
  await page.reload();
  await page.getByRole('button', { name: 'マイページ', exact: true }).click();
  await expect(page.getByLabel('スキン', { exact: true })).toHaveValue('crystal');
  await expect.poll(image).toBe(crystal);
  await page.getByLabel('スキン', { exact: true }).selectOption('metal');
  await expect.poll(image).not.toBe(crystal);
  expect(await image()).not.toBe(fiber);
  await page.getByLabel('スキン', { exact: true }).selectOption('texture');
  await expect.poll(image).toBe(fiber);
  await page.locator('#mypage-close').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: 'テトクラ ホーム' })).toBeVisible();
  await expect(page.locator('.brand-sub')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('unknown saved skin falls back to fiber and blocked storage still permits switching', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('tetcla-skin', 'unknown'));
  await page.goto('/');
  await page.getByRole('button', { name: 'マイページ', exact: true }).click();
  await expect(page.getByLabel('スキン', { exact: true })).toHaveValue('texture');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage disabled');
    };
  });
  const next = page.locator('#next-0');
  const fiber = await next.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByLabel('スキン', { exact: true }).selectOption('crystal');
  await expect
    .poll(() => next.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
    .not.toBe(fiber);
});

test('my page pauses a sprint and keeps controls inside the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.bottom-bar #skin-select')).toHaveCount(0);
  await page.locator('#sprint').click();
  await startSolo(page);
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await page.locator('#mypage-open').click();
  const dialog = page.getByRole('dialog', { name: 'マイページ', exact: true });
  await expect(dialog).toBeVisible();
  const time = await page.locator('#timer').innerText();
  const board = await page
    .locator('#board-0')
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.locator('#mypage-title').click();
  await page.keyboard.press('Space');
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await expect(page.locator('#timer')).toHaveText(time);
  expect(
    await page.locator('#board-0').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
  ).toBe(board);
  const preview = page.locator('#skin-preview-1');
  const fiber = await preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByLabel('スキン', { exact: true }).selectOption('metal');
  await expect
    .poll(() => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
    .not.toBe(fiber);
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.locator('#mypage-close').click();
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
  await page.locator('#pause').click();
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await expect(page.locator('#timer')).not.toHaveText(time);
});

for (const width of [1440, 390]) {
  test(`color sliders redraw, persist and stay inside My Page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => localStorage.setItem('tetcla-palette', 'vivid'));
    await page.goto('/');
    const saturation = page.getByLabel('彩度', { exact: true });
    const transparency = page.getByLabel('透明度', { exact: true });
    await expect(saturation).toHaveValue('100');
    await expect(transparency).toHaveValue('0');
    await page.locator('#mypage-open').click();
    await expect(page.locator('#palette-select')).toHaveCount(0);
    await expect(page.locator('#palette-color-0')).toHaveText('#60d7e9');
    for (const skin of ['neon', 'texture', 'pattern']) {
      await page.locator('#skin-select').selectOption(skin);
      await expect(page.locator('#skin-select')).toHaveValue(skin);
    }
    await expect(page.locator('#mypage-dialog .mino-adjustments')).toBeVisible();
    const next = page.locator('#next-0');
    const image = () => next.evaluate((c: HTMLCanvasElement) => c.toDataURL());
    const original = await image();
    await saturation.fill('0');
    await expect(page.locator('#mino-saturation-value')).toHaveText('0%');
    await expect.poll(image).not.toBe(original);
    const gray = await next.evaluate((c: HTMLCanvasElement) => {
      const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      return Array.from({ length: pixels.length / 4 }, (_, i) => i * 4).every(
        (i) => pixels[i] === pixels[i + 1] && pixels[i + 1] === pixels[i + 2],
      );
    });
    expect(gray).toBe(true);
    await transparency.fill('100');
    await expect
      .poll(() =>
        next.evaluate((c: HTMLCanvasElement) =>
          c
            .getContext('2d')!
            .getImageData(0, 0, c.width, c.height)
            .data.every((value) => value === 0),
        ),
      )
      .toBe(true);
    await saturation.fill('65');
    await transparency.fill('35');
    await page.reload();
    await page.locator('#mypage-open').click();
    await expect(saturation).toHaveValue('65');
    await expect(transparency).toHaveValue('35');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('connected surfaces remove interior seams for every material', async ({ page }) => {
  await page.goto('/');
  const samples = await page.evaluate(async () => {
    const renderPath = '/apps/web/render.ts';
    const enginePath = '/packages/core/engine.ts';
    const skinsPath = '/apps/web/skins.ts';
    const { drawBoard } = await import(renderPath);
    const { createPlayer } = await import(enginePath);
    const { setSkin } = await import(skinsPath);
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 615;
    const ctx = canvas.getContext('2d')!;
    return ['classic', 'crystal', 'metal', 'neon', 'texture', 'pattern'].map((skin) => {
      setSkin(skin);
      const player = createPlayer(42, 43);
      player.active = null;
      player.board[39][3] = 'S';
      drawBoard(canvas, player);
      const edge = [...ctx.getImageData(119, 600, 1, 1).data];
      player.board[39][4] = 'S';
      drawBoard(canvas, player);
      return {
        skin,
        edge,
        joined: [...ctx.getImageData(119, 600, 1, 1).data],
        center: [...ctx.getImageData(120, 600, 1, 1).data],
      };
    });
  });
  for (const sample of samples) {
    expect(sample.joined, sample.skin).not.toEqual(sample.edge);
    // Both sides of the old boundary carry the same material, without a dark gap.
    expect(Math.abs(sample.joined[1] - sample.center[1]), sample.skin).toBeLessThan(35);
  }
});
