import { expect, test } from '@playwright/test';

test('回転音10案と連続版をデコードし、順番比較・切替・停止・音量調整ができる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const starts: { url: string; volume: number }[] = [];
    Object.assign(window, { rotationPreviews: starts });
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      starts.push({ url: this.src, volume: this.volume });
      return original.call(this);
    };
  });
  await page.goto('/rotation-preview/index.html');
  await expect(page.locator('article')).toHaveCount(10);
  await expect(page.getByRole('link', { name: /MP3をダウンロード/ })).toHaveCount(10);
  const clips = await page.evaluate(async () => {
    const manifest = await (await fetch('./manifest.json')).json();
    const context = new AudioContext();
    const decoded = [];
    for (const sample of manifest) {
      for (const file of [sample.file, sample.repeatFile]) {
        const response = await fetch(file);
        if (!response.ok) throw new Error(`${file}: ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        let peak = 0;
        let energy = 0;
        for (const value of buffer.getChannelData(0)) {
          peak = Math.max(peak, Math.abs(value));
          energy += value * value;
        }
        decoded.push({
          file,
          duration: buffer.duration,
          expectedDuration: file === sample.repeatFile ? 2.8 : sample.duration,
          peak,
          energy,
        });
      }
    }
    await context.close();
    return decoded;
  });
  expect(clips).toHaveLength(20);
  for (const clip of clips) {
    expect(clip.duration).toBeCloseTo(clip.expectedDuration, 3);
    expect(clip.peak).toBeGreaterThan(0.04);
    expect(clip.peak).toBeLessThan(0.5);
    expect(clip.energy).toBeGreaterThan(1);
    if (!clip.file.includes('_repeat')) {
      expect(clip.duration).toBeGreaterThanOrEqual(0.13);
      expect(clip.duration).toBeLessThan(0.27);
    }
  }
  await page.locator('#volume').fill('40');
  await page.getByRole('button', { name: '10種類を単発で比較', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('試聴が終わりました。', { timeout: 15000 });
  const starts = await page.evaluate(
    () =>
      (
        window as unknown as {
          rotationPreviews: { url: string; volume: number }[];
        }
      ).rotationPreviews,
  );
  expect(starts).toHaveLength(10);
  expect(new Set(starts.map((start) => start.url)).size).toBe(10);
  expect(starts.every((start) => start.volume === 0.4)).toBe(true);
  await page.getByRole('button', { name: '10種類を連続回転で比較', exact: true }).click();
  await expect(page.locator('#status')).toContainText('01 木玉ころころ / 連続回転');
  await page.getByRole('button', { name: 'クラウド・シンセを単発で聴く', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('試聴が終わりました。');
  await page.getByRole('button', { name: '木玉ころころを連続回転で聴く', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.waitForTimeout(700);
  await expect(page.locator('#status')).toHaveText('停止しました。');
  await expect(page.locator('article[data-playing="true"]')).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
