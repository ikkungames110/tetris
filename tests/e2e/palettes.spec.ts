import { expect, test } from '@playwright/test';

test('all palettes redraw paused board, HOLD and NEXT and persist', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Shift');
  await page.getByRole('button', { name: 'マイページ', exact: true }).click();
  const picker = page.getByLabel('配色（開発用）', { exact: true });
  await expect(picker.locator('option')).toHaveCount(5);
  const images = () =>
    page
      .locator('#board-0, #hold-0, #next-0')
      .evaluateAll((canvases) =>
        canvases.map((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
      );
  let previous = await images();
  expect(previous).toHaveLength(3);
  for (const palette of ['sunset', 'botanical', 'candy', 'arcade', 'aurora']) {
    await picker.selectOption(palette);
    await expect
      .poll(async () => {
        const current = await images();
        return current.every((value, i) => value !== previous[i]);
      })
      .toBe(true);
    previous = await images();
  }
  await picker.selectOption('candy');
  await page.reload();
  await page.getByRole('button', { name: 'マイページ', exact: true }).click();
  await expect(picker).toHaveValue('candy');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(picker).toBeVisible();
  expect(
    await page
      .locator('#mypage-dialog')
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  ).toBe(true);
});

test('invalid saved palette falls back and storage failures permit switching', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tetcla-palette', 'unknown'));
  await page.goto('/');
  await page.getByRole('button', { name: 'マイページ', exact: true }).click();
  const picker = page.getByLabel('配色（開発用）', { exact: true });
  await expect(picker).toHaveValue('aurora');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage disabled');
    };
  });
  const preview = page.locator('#skin-preview-0');
  const before = await preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await picker.selectOption('arcade');
  await expect
    .poll(() => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
    .not.toBe(before);
});
