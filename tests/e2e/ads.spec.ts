import { startSolo } from '../helpers/solo';
import { expect, test } from '@playwright/test';

for (const width of [320, 761, 1024, 1366, 1920]) {
  test(`プロトタイプでは幅${width}pxでも広告・案内・配信通信を出さない`, async ({ page }) => {
    const requests: string[] = [];
    await page.route('https://**.i-mobile.co.jp/**', (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.setViewportSize({ width, height: 1080 });
    await page.goto('/');
    await expect(page.locator('#start')).toBeHidden();
    await expect(page.locator('.ad-rail, .ad-slot, iframe')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/広告枠|広告配信待ち|ADVERTISEMENT/);
    if (width > 760) {
      const main = (await page.locator('main').boundingBox())!;
      expect(Math.round(main.width)).toBe(Math.min(width - 32, 1280));
      expect(Math.round(main.x + main.width / 2)).toBe(Math.round(width / 2));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await startSolo(page);
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
    await page.setViewportSize({ width: width === 320 ? 1920 : 320, height: 844 });
    await expect(page.locator('.ad-rail, .ad-slot, iframe')).toHaveCount(0);
    expect(requests).toEqual([]);
  });
}
