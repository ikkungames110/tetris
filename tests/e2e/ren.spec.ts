import { expect, test } from '@playwright/test';
import { completedSprint } from '../helpers/sprint';

for (const width of [1440, 390, 320]) {
  test(`ren grows below HOLD and stays outside the board at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.load('700 16px Rajdhani'));
    const sizes = await page.evaluate(async () => {
      // 同じ描画処理を長い連続数でも確認する。毎フレーム更新する実ゲーム表示と分離する。
      const modulePath = '/apps/web/ren.ts';
      const { renderRen } = await import(modulePath);
      const sample = document.querySelector<HTMLElement>('#ren-0')!.cloneNode(true) as HTMLElement;
      sample.removeAttribute('id');
      sample.querySelector('strong')!.removeAttribute('id');
      document.querySelector('.hold-side')!.append(sample);
      const result = [];
      for (const ren of [-1, 0, 1, 2, 3, 8, 40, 1000, -1]) {
        renderRen(sample, ren);
        const box = sample.getBoundingClientRect();
        const board = document.querySelector('#board-0')!.getBoundingClientRect();
        const hold = document.querySelector('#hold-0')!.getBoundingClientRect();
        result.push({
          ren,
          hidden: sample.hidden,
          text: sample.textContent,
          size: parseFloat(getComputedStyle(sample.querySelector('strong')!).fontSize),
          outside: box.right <= board.left,
          below: box.top - hold.bottom,
          fits:
            sample.scrollWidth <= sample.clientWidth &&
            sample.querySelector('strong')!.getBoundingClientRect().left >= box.left &&
            sample.querySelector('span')!.getBoundingClientRect().right <= box.right,
          inline:
            sample.querySelector('strong')!.getBoundingClientRect().right <=
            sample.querySelector('span')!.getBoundingClientRect().left,
          oneLine:
            sample.querySelector('strong')!.getBoundingClientRect().bottom >=
            sample.querySelector('span')!.getBoundingClientRect().top,
          label: sample.getAttribute('aria-label'),
        });
      }
      sample.remove();
      return result;
    });
    for (const item of sizes) {
      expect(item.hidden).toBe(item.ren + 1 < 2);
      if (item.ren + 1 >= 2) {
        expect(item.text).toBe(`${item.ren + 1} REN`);
        expect(item.outside).toBe(true);
        expect(item.below).toBeGreaterThan(45);
        expect(item.fits).toBe(true);
        expect(item.inline).toBe(true);
        expect(item.oneLine).toBe(true);
        expect(item.label).toBe(`${item.ren + 1} REN（連続消去）`);
      }
    }
    expect(sizes[2].size).toBeGreaterThanOrEqual(22);
    expect(sizes[3].size).toBeGreaterThan(sizes[2].size);
    expect(sizes[5].size).toBeGreaterThan(sizes[3].size);
    expect(sizes[7].size).toBeLessThanOrEqual(40);
  });
}

test('replay shows 2 REN only during the chain and clears it after a non-clear drop', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const observed: string[] = [];
    Object.assign(window, { renObserved: observed });
    const element = document.querySelector<HTMLElement>('#ren-0')!;
    new MutationObserver(() => {
      const state = element.hidden ? 'hidden' : element.textContent!;
      if (observed.at(-1) !== state) observed.push(state);
    }).observe(element, { attributes: true, subtree: true, childList: true, characterData: true });
  });
  await page.locator('#replay-file').setInputFiles({
    name: 'ren.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(completedSprint())),
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { renObserved: string[] }).renObserved), {
      timeout: 8000,
    })
    .toContain('2 REN');
  await expect(page.locator('#ren-0')).toBeHidden();
  const observed = await page.evaluate(
    () => (window as unknown as { renObserved: string[] }).renObserved,
  );
  expect(observed.slice(observed.indexOf('2 REN'))).toContain('hidden');
  expect(observed).toContain('3 REN');
  expect(observed).not.toContain('1 REN');
});
