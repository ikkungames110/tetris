import { expect, test } from '@playwright/test';

test('エンドレスは操作なしで落下を始め、スタート・終了・名前を表示しない', async ({ page }) => {
  await page.goto('/');
  for (const selector of ['#start', '#leave', '#timer', '.player-0 > .player-identity'])
    await expect(page.locator(selector)).toBeHidden();
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  const board = page.locator('#board-0');
  const pixels = () => board.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const before = await pixels();
  await expect.poll(pixels).not.toBe(before);
  await expect(page.locator('#login-open')).toBeEnabled();
  await page.locator('#sprint').click();
  await expect(page.locator('#board-overlay-0')).toContainText('READY');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#leave')).toBeHidden();
  await page.locator('#start').click();
  await expect(page.locator('#board-overlay-0')).toContainText('3');
  await page.locator('#practice').click();
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await page.locator('#sprint').click();
  await page.locator('#start').click();
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await page.locator('#online').click();
  await expect(page.locator('#online-lobby')).toBeVisible();
  await expect(page.locator('#online')).toHaveAttribute('aria-pressed', 'true');
});
