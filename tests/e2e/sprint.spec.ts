import { expect, test } from '@playwright/test';
import fixture from '../fixtures/sprint-clear.json' with { type: 'json' };

// Drive one real application frame per recorded input. This exercises the normal
// keyboard/engine/render/result path without waiting for a human-speed full run.
test('40LINE shows the final time, freezes it and starts another sprint from the result', async ({
  page,
}) => {
  await page.addInitScript((seed) => {
    let callback: FrameRequestCallback;
    let frame = 0;
    Object.defineProperty(performance, 'now', { value: () => 0 });
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (values: Uint32Array) => {
        values.fill(seed);
        return values;
      },
    });
    window.requestAnimationFrame = (fn) => {
      callback = fn;
      return 1;
    };
    Object.assign(window, {
      advance: (keys: string) => {
        const codes: Record<string, string> = {
          L: 'ArrowLeft',
          R: 'ArrowRight',
          X: 'KeyX',
          H: 'Space',
        };
        for (const key of keys) {
          if (codes[key]) {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: codes[key] }));
            window.dispatchEvent(new KeyboardEvent('keyup', { code: codes[key] }));
          }
          callback(++frame * (1000 / 60 + 0.000001));
        }
      },
    });
  }, fixture.seed);
  await page.goto('/');
  await page.evaluate((placements) => {
    const click = (selector: string) =>
      document.querySelector<HTMLButtonElement>(selector)!.click();
    click('#sprint');
    click('#start');
    (window as unknown as { advance: (keys: string) => void }).advance(
      '.'.repeat(180) + placements.join(''),
    );
  }, fixture.placements);
  await expect(page.locator('#result-dialog')).toBeVisible();
  await expect(page.locator('#result-title')).toHaveText('40LINE CLEAR');
  await expect(page.locator('#result-description')).toHaveText('クリアタイム: 00:15.616');
  await expect(page.locator('#timer')).toHaveText('00:15.616');
  await expect(page.locator('#line-progress')).toHaveText('40 / 40');
  await expect(page.locator('#best-status')).toHaveText('保存しました');
  await expect(page.locator('#best-time')).toHaveText('00:15.616');
  await page.evaluate(() =>
    (window as unknown as { advance: (keys: string) => void }).advance('.'.repeat(120)),
  );
  await expect(page.locator('#timer')).toHaveText('00:15.616');
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#result-next')!.click();
    (window as unknown as { advance: (keys: string) => void }).advance('.');
  });
  await expect(page.locator('#result-dialog')).not.toBeVisible();
  await expect(page.locator('#sprint')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#timer')).toHaveText('00:00.000');
  await expect(page.locator('#line-progress')).toHaveText('0 / 40');
  await expect(page.locator('#best-time')).toHaveText('00:15.616');
});
