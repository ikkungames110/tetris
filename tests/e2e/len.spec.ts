import { expect, test } from '@playwright/test';
import { completedSprint } from '../helpers/sprint';

for (const width of [1440, 390]) {
  test(`len grows below HOLD and stays outside the board at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const sizes = await page.evaluate(async () => {
      // 同じ描画処理を長い連続数でも確認する。毎フレーム更新する実ゲーム表示と分離する。
      const modulePath = '/apps/web/len.ts';
      const { renderLen } = await import(modulePath);
      const sample = document.querySelector<HTMLElement>('#len-0')!.cloneNode(true) as HTMLElement;
      sample.removeAttribute('id');
      sample.querySelector('strong')!.removeAttribute('id');
      document.querySelector('.hold-side')!.append(sample);
      const result = [];
      for (const ren of [-1, 0, 1, 2, 3, 8, 40, 1000, -1]) {
        renderLen(sample, ren);
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
          fits: sample.scrollWidth <= sample.clientWidth,
        });
      }
      sample.remove();
      return result;
    });
    for (const item of sizes) {
      expect(item.hidden).toBe(item.ren < 2);
      if (item.ren >= 2) {
        expect(item.text).toBe(`${item.ren}len`);
        expect(item.outside).toBe(true);
        expect(item.below).toBeGreaterThan(45);
        expect(item.fits).toBe(true);
      }
    }
    expect(sizes[4].size).toBeGreaterThan(sizes[3].size);
    expect(sizes[5].size).toBeGreaterThan(sizes[4].size);
    expect(sizes[7].size).toBeLessThanOrEqual(30);
  });
}

test('replay shows 2len only during the chain and clears it after a non-clear drop', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const observed: string[] = [];
    Object.assign(window, { lenObserved: observed });
    const element = document.querySelector<HTMLElement>('#len-0')!;
    new MutationObserver(() => {
      const state = element.hidden ? 'hidden' : element.textContent!;
      if (observed.at(-1) !== state) observed.push(state);
    }).observe(element, { attributes: true, subtree: true, childList: true, characterData: true });
  });
  await page.locator('#replay-file').setInputFiles({
    name: 'len.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(completedSprint())),
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { lenObserved: string[] }).lenObserved), {
      timeout: 8000,
    })
    .toContain('2len');
  await expect(page.locator('#len-0')).toBeHidden();
  const observed = await page.evaluate(
    () => (window as unknown as { lenObserved: string[] }).lenObserved,
  );
  expect(observed.slice(observed.indexOf('2len'))).toContain('hidden');
  expect(observed).not.toContain('1len');
});
