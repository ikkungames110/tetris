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
  const next = page.locator('#next-0');
  const image = () => next.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const classic = await image();
  await page.getByLabel('スキン', { exact: true }).selectOption('crystal');
  await expect.poll(image).not.toBe(classic);
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
  expect(await image()).not.toBe(classic);
  await page.getByLabel('スキン', { exact: true }).selectOption('classic');
  await expect.poll(image).toBe(classic);
  await page.locator('#mypage-close').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: 'テトクラ ホーム' })).toBeVisible();
  await expect(page.locator('.brand-sub')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('unknown saved skin falls back to classic and blocked storage still permits switching', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('tetcla-skin', 'unknown'));
  await page.goto('/');
  await page.getByRole('button', { name: 'マイページ', exact: true }).click();
  await expect(page.getByLabel('スキン', { exact: true })).toHaveValue('classic');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage disabled');
    };
  });
  const next = page.locator('#next-0');
  const classic = await next.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByLabel('スキン', { exact: true }).selectOption('crystal');
  await expect
    .poll(() => next.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
    .not.toBe(classic);
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
  const classic = await preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByLabel('スキン', { exact: true }).selectOption('metal');
  await expect
    .poll(() => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
    .not.toBe(classic);
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.locator('#mypage-close').click();
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
  await page.locator('#pause').click();
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await expect(page.locator('#timer')).not.toHaveText(time);
});
