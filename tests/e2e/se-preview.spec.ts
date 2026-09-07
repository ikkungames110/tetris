import { expect, test } from '@playwright/test';

test('SE候補18個をデコードでき、音色ごとの連続試聴・停止・音量調整ができる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/se-preview/index.html');
  await expect(page.locator('audio')).toHaveCount(18);
  await expect(page.getByRole('link', { name: /MP3をダウンロード/ })).toHaveCount(18);
  const clips = await page.evaluate(async () => {
    const context = new AudioContext();
    const results = [];
    for (const player of document.querySelectorAll('audio')) {
      const response = await fetch(player.src);
      if (!response.ok) throw new Error(`${response.status}: ${player.src}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      let peak = 0;
      let energy = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        for (const value of buffer.getChannelData(channel)) {
          peak = Math.max(peak, Math.abs(value));
          energy += value * value;
        }
      }
      results.push({ duration: buffer.duration, peak, energy, channels: buffer.numberOfChannels });
    }
    await context.close();
    return results;
  });
  for (const clip of clips) {
    expect(clip.duration).toBeGreaterThan(0.08);
    expect(clip.duration).toBeLessThan(0.9);
    expect(clip.peak).toBeGreaterThan(0.05);
    expect(clip.peak).toBeLessThan(0.5);
    expect(clip.energy).toBeGreaterThan(0.1);
    expect(clip.channels).toBe(2);
  }
  await page.locator('#volume').fill('35');
  await expect(page.locator('#volume-value')).toHaveText('35%');
  expect(
    await page
      .locator('audio')
      .evaluateAll((players: HTMLAudioElement[]) =>
        players.every((player) => player.volume === 0.35),
      ),
  ).toBe(true);
  await page.evaluate(() => {
    const played: string[] = [];
    Object.assign(window, { playedSamples: played });
    for (const player of document.querySelectorAll('audio')) {
      player.addEventListener('play', () => played.push(player.getAttribute('aria-label')!));
    }
  });
  await page.getByRole('button', { name: 'Aを6種類、順番に聴く' }).click();
  await expect(page.locator('#status')).toHaveText('試聴が終わりました。', { timeout: 10000 });
  const played = await page.evaluate(
    () => (window as unknown as { playedSamples: string[] }).playedSamples,
  );
  expect(played).toHaveLength(6);
  expect(played[0]).toBe('ミノ設置・A / Wood');
  expect(played[5]).toBe('ライン消去（4LINE）・A / Wood');
  await page.getByRole('button', { name: 'Bを6種類、順番に聴く' }).click();
  await page.getByRole('button', { name: 'すべて停止' }).click();
  await expect(page.locator('#status')).toHaveText('停止しました。');
  await page.waitForTimeout(500);
  expect(
    await page
      .locator('audio')
      .evaluateAll((players: HTMLAudioElement[]) =>
        players.every((player) => player.paused && player.currentTime === 0),
      ),
  ).toBe(true);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
