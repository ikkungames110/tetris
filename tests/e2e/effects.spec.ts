import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`line clear shows an upper translucent label and respects ${reducedMotion} motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/');
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#particles-0')!;
      const ctx = canvas.getContext('2d')!;
      const observed = { maxAlpha: 0, visibleFrames: 0 };
      Object.assign(window, { observedClear: observed });
      const end = performance.now() + 7000;
      function sample() {
        const pixels = ctx.getImageData(0, 540, 300, 60).data;
        let alpha = 0;
        for (let i = 3; i < pixels.length; i += 4) alpha = Math.max(alpha, pixels[i]);
        observed.maxAlpha = Math.max(observed.maxAlpha, alpha);
        if (alpha > 0) observed.visibleFrames++;
        if (performance.now() < end) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await page
      .locator('#replay-file')
      .setInputFiles(fileURLToPath(new URL('../fixtures/line-clear.replay.json', import.meta.url)));
    await expect(page.locator('#clear-0')).toHaveText('SINGLE', { timeout: 6000 });
    const label = await page.locator('#clear-0').boundingBox();
    const board = await page.locator('#board-0').boundingBox();
    expect((label!.y - board!.y) / board!.height).toBeLessThan(0.18);
    await expect(page.locator('#clear-0')).toHaveCSS('opacity', '0.55');
    await page.waitForTimeout(800);
    const observed = await page.evaluate(
      () =>
        (window as unknown as { observedClear: { maxAlpha: number; visibleFrames: number } })
          .observedClear,
    );
    if (reducedMotion === 'reduce') expect(observed.maxAlpha).toBe(0);
    else {
      expect(observed.maxAlpha).toBeGreaterThan(0);
      expect(observed.maxAlpha).toBeLessThan(255);
      expect(observed.visibleFrames).toBeGreaterThan(2);
    }
    const empty = await page.locator('#particles-0').evaluate((canvas: HTMLCanvasElement) =>
      canvas
        .getContext('2d')!
        .getImageData(0, 0, 300, 600)
        .data.every((value) => value === 0),
    );
    expect(empty).toBe(true);
    await expect(page.locator('#notice')).toContainText('記録と盤面の一致');
  });
}
