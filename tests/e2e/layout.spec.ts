import { expect, test } from '@playwright/test';
import { startSolo } from '../helpers/solo';

for (const [width, height] of [
  [1920, 1080],
  [1440, 1000],
  [1280, 720],
  [1024, 768],
  [761, 1080],
  [390, 844],
  [320, 568],
  [844, 390],
]) {
  for (const mode of ['practice', 'sprint']) {
    test(`${mode} ${width}x${height}: 盤面を画面中央に保ち、開始・一時停止・リスタートで動かさない`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.locator(`#${mode}`).click();
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (let i = 0; i < 3; i++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      await expect(page.locator('#leave')).toBeHidden();
      await expect(page.locator('.player-0 > .player-identity')).toBeHidden();
      const board = (await page.locator('#board-0').boundingBox())!;
      expect(Math.abs(board.x + board.width / 2 - width / 2)).toBeLessThanOrEqual(0.5);
      if (width > 760 && height > 540) {
        const controls = (await page.locator('.quick-controls-panel').boundingBox())!;
        expect(controls.x).toBeGreaterThanOrEqual(0);
        expect(controls.x + controls.width).toBeLessThanOrEqual(board.x);
        expect(controls.y).toBeLessThan(board.y + board.height);
      }
      if (mode === 'practice') {
        await expect(page.locator('#timer')).toBeHidden();
        await expect(page.locator('#personal-best')).toBeHidden();
      } else {
        await expect(page.locator('#timer')).toBeVisible();
        await expect(page.locator('#personal-best')).toBeVisible();
        for (const selector of ['#timer', '#personal-best']) {
          const box = (await page.locator(selector).boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(board.x + board.width);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
      }
      // 各フレームを計測し、クリック直後だけ発生する位置ずれも検出する。
      await page.evaluate(() => {
        const selectors = [
          '.site-header',
          '.toolbar',
          '.bgm-picker',
          '#arena',
          '#board-0',
          '#start',
          '#pause',
        ].filter((selector) => document.querySelector(selector)!.getClientRects().length > 0);
        const measure = () =>
          selectors.map((selector) => {
            const rect = document.querySelector(selector)!.getBoundingClientRect();
            return [rect.x + scrollX, rect.y + scrollY, rect.width, rect.height];
          });
        const before = measure();
        const state = { running: true, shifts: [] as string[] };
        Object.assign(window, { layoutCheck: state });
        const check = () => {
          measure().forEach((values, i) => {
            if (values.some((value, j) => Math.abs(value - before[i][j]) > 0.5))
              state.shifts.push(`${selectors[i]}: ${before[i]} -> ${values}`);
          });
          if (state.running) requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      await startSolo(page);
      await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
      await page.locator('#pause').click();
      await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
      await startSolo(page);
      await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
      await expect(page.locator('#leave')).toBeHidden();
      const shifts = await page.evaluate(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const state = (window as unknown as { layoutCheck: { running: boolean; shifts: string[] } })
          .layoutCheck;
        state.running = false;
        return [...new Set(state.shifts)];
      });
      expect(shifts).toEqual([]);
      if (mode === 'practice') await expect(page.locator('#timer')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }
}
