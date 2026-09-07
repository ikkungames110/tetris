import { expect, test } from '@playwright/test';

test('BGMの実音源をデコードし、再生中に選曲・音量を変更して保存できる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.addInitScript(() => {
    const original = AudioContext.prototype.decodeAudioData;
    const durations: number[] = [];
    Object.assign(window, { audioDurations: durations });
    AudioContext.prototype.decodeAudioData = function (data: ArrayBuffer) {
      return original.call(this, data).then((buffer) => {
        durations.push(buffer.duration);
        return buffer;
      });
    };
  });
  await page.goto('/');
  await expect(page.locator('#bgm-select')).toHaveValue('picopicodisco');
  await expect(page.locator('#bgm-select option')).toHaveCount(10);
  await page.locator('#start').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { audioDurations: number[] }).audioDurations.length,
      ),
    )
    .toBe(5);
  await expect(page.locator('#audio-status')).toBeHidden();
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await page.locator('#bgm-select').selectOption('chess');
  await page.keyboard.press('Space');
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { audioDurations: number[] }).audioDurations.length,
      ),
    )
    .toBe(6);
  await page.locator('#bgm-select').selectOption('random');
  await page.locator('#settings-open').click();
  await expect(page.locator('#bgm-volume')).toBeVisible();
  await expect(page.locator('#device-0')).toBeHidden();
  await page.locator('#controller-settings > summary').click();
  await expect(page.locator('#device-0')).toBeVisible();
  for (const [kind, value] of [
    ['bgm', '23'],
    ['se', '81'],
  ]) {
    await page.locator(`#${kind}-volume`).fill(value);
    await expect(page.locator(`#${kind}-volume-value`)).toHaveText(`${value}%`);
  }
  await page.locator('#settings-close').click();
  await page.locator('#sound').click();
  await expect(page.locator('#sound')).toHaveText('音 OFF');
  await page.reload();
  await expect(page.locator('#bgm-select')).toHaveValue('random');
  await expect(page.locator('#sound')).toHaveText('音 OFF');
  await page.locator('#settings-open').click();
  await expect(page.locator('#bgm-volume')).toHaveValue('23');
  await expect(page.locator('#se-volume')).toHaveValue('81');
  expect(errors).toEqual([]);
});
