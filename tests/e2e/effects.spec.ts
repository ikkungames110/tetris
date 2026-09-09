import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`line clear has only particles and respects ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/');
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#particles-0')!;
      const ctx = canvas.getContext('2d')!;
      const observed = { maxAlpha: 0, visibleFrames: 0 };
      Object.assign(window, { observedClear: observed });
      const end = performance.now() + 7000;
      function sample() {
        const pixels = ctx.getImageData(0, canvas.height - 60, canvas.width, 60).data;
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
    await expect(page.locator('#lines-0')).toHaveText('1', { timeout: 6000 });
    await expect(page.locator('#clear-0')).toHaveText('');
    await page.waitForTimeout(1200);
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
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.every((value) => value === 0),
    );
    expect(empty).toBe(true);
    await expect(page.locator('#notice')).toContainText('記録と盤面の一致');
  });
}

test('clear callout fades near the centre with small text and six aligned streaks', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/apps/web/clear-callout.ts';
    const { ClearCallout } = await import(path);
    const element = document.querySelector<HTMLElement>('#clear-0')!;
    const callout = new ClearCallout(element);
    callout.update('T-SPIN DOUBLE', '1:10');
    const animation = element.getAnimations()[0];
    animation.pause();
    const frames = (animation.effect as KeyframeEffect).getKeyframes();
    animation.currentTime = 850;
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    const centre = { x: matrix.m41, y: matrix.m42 };
    const fade = [0, 180, 850, 1450, 1700].map((time) => {
      animation.currentTime = time;
      return Number(getComputedStyle(element).opacity);
    });
    // The text and the middle streak on each side must share the same axis,
    // including while travelling in and out of the board.
    const alignment = [150, 850, 1500].map((time) => {
      animation.currentTime = time;
      const transform = new DOMMatrix(getComputedStyle(element).transform);
      const text = element.querySelector('.clear-text')!.getBoundingClientRect();
      const offsets = [...element.querySelectorAll('.clear-streaks i:nth-child(2)')].map((line) => {
        const rect = line.getBoundingClientRect();
        const dx = rect.x + rect.width / 2 - (text.x + text.width / 2);
        const dy = rect.y + rect.height / 2 - (text.y + text.height / 2);
        return Math.abs(dx * transform.b - dy * transform.a);
      });
      return { angle: Math.atan2(transform.b, transform.a), offsets };
    });
    callout.update('T-SPIN DOUBLE', '1:10');
    const sameAnimation = element.getAnimations()[0] === animation;
    callout.update('T-SPIN DOUBLE', '1:20');
    const retriggered = element.getAnimations()[0] !== animation;
    const active = element.getAnimations()[0];
    active.pause();
    active.currentTime = 850;
    document.querySelector<HTMLElement>('#board-overlay-0')!.hidden = true;
    return {
      frames,
      centre,
      fade,
      travel: [frames[0], frames.at(-1)!].map((frame) =>
        Math.abs(new DOMMatrix(frame.transform as string).m41),
      ),
      alignment,
      sameAnimation,
      retriggered,
      opposite:
        new DOMMatrix(frames[0].transform as string).m41 *
          new DOMMatrix(frames.at(-1)!.transform as string).m41 <
        0,
      lines: element.querySelectorAll('.clear-streaks i').length,
      font: getComputedStyle(element).fontFamily,
      fontSize: parseFloat(getComputedStyle(element).fontSize),
      clipping: getComputedStyle(element.parentElement!).clipPath,
      effectLayer: getComputedStyle(element).zIndex,
      sideLayer: getComputedStyle(document.querySelector('.hold-side')!).zIndex,
    };
  });
  expect(result.centre).toEqual({ x: 0, y: 0 });
  for (const distance of result.travel) {
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThanOrEqual(24);
  }
  expect(result.fade[0]).toBe(0);
  expect(result.fade[1]).toBeGreaterThan(0);
  expect(result.fade[1]).toBeLessThan(result.fade[2]);
  expect(result.fade[2]).toBeCloseTo(0.62);
  expect(result.fade[3]).toBeGreaterThan(0);
  expect(result.fade[3]).toBeLessThan(result.fade[2]);
  expect(result.fade[4]).toBe(0);
  expect(result.fontSize).toBeLessThanOrEqual(22);
  for (const sample of result.alignment) {
    expect(sample.angle).toBeCloseTo(result.alignment[0].angle, 5);
    for (const offset of sample.offsets) expect(offset).toBeLessThan(1);
  }
  expect(result.frames[1].transform).toBe(result.frames[2].transform);
  expect(result.opposite).toBe(true);
  expect(result.sameAnimation).toBe(true);
  expect(result.retriggered).toBe(true);
  expect(result.lines).toBe(6);
  expect(result.font).toContain('Rajdhani');
  expect(result.clipping).not.toBe('none');
  expect(Number(result.sideLayer)).toBeGreaterThan(Number(result.effectLayer));
  await page.screenshot({ path: 'test-results/clear-callout-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/clear-callout-mobile.png' });
});

test('reduced-motion callouts only fade without moving or showing streaks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const frames = await page.evaluate(async () => {
    const path = '/apps/web/clear-callout.ts';
    const { ClearCallout } = await import(path);
    const element = document.querySelector<HTMLElement>('#clear-0')!;
    new ClearCallout(element).update('PERFECT CLEAR', '1:20');
    return (element.getAnimations()[0].effect as KeyframeEffect).getKeyframes();
  });
  expect(frames.every((frame) => !frame.transform)).toBe(true);
  expect(frames.map((frame) => Number(frame.opacity))).toEqual([0, 0.62, 0.62, 0]);
  await expect(page.locator('#clear-0 .clear-streaks').first()).toBeHidden();
});
