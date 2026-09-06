import { expect, test } from '@playwright/test';

test('skin changes redraw unchanged pieces and persist without starting a game', async ({
  page,
}) => {
  await page.goto('/');
  const next = page.locator('#next-0');
  const image = () => next.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const classic = await image();
  await page.getByLabel('スキン', { exact: true }).selectOption('crystal');
  await expect.poll(image).not.toBe(classic);
  const crystal = await image();
  await page.getByLabel('スキン', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#board-overlay-0')).toContainText('READY');
  await page.reload();
  await expect(page.getByLabel('スキン', { exact: true })).toHaveValue('crystal');
  await expect.poll(image).toBe(crystal);
  await page.getByLabel('スキン', { exact: true }).selectOption('metal');
  await expect.poll(image).not.toBe(crystal);
  expect(await image()).not.toBe(classic);
  await page.getByLabel('スキン', { exact: true }).selectOption('classic');
  await expect.poll(image).toBe(classic);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.brand-sub')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('unknown saved skin falls back to classic and blocked storage still permits switching', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('tetcla-skin', 'unknown'));
  await page.goto('/');
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
