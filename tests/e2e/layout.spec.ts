import { expect, test } from '@playwright/test';

for (const [width, height] of [
  [1920, 1080],
  [1440, 1000],
  [1280, 720],
  [1024, 768],
  [390, 844],
  [320, 568],
  [844, 390],
]) {
  for (const mode of ['practice', 'sprint']) {
    test(`${mode} ${width}x${height}: 開始・一時停止・はじめから・終了で盤面と操作欄が動かない`, async ({
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
      await expect(page.locator('#leave')).toBeDisabled();
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
        ];
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
      await page.locator('#start').click();
      await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
      await page.locator('#pause').click();
      await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
      await page.locator('#start').click();
      await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
      await page.locator('#leave').click();
      await expect(page.locator('#leave')).toBeDisabled();
      const shifts = await page.evaluate(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const state = (window as unknown as { layoutCheck: { running: boolean; shifts: string[] } })
          .layoutCheck;
        state.running = false;
        return [...new Set(state.shifts)];
      });
      expect(shifts).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }
}
