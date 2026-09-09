import { expect, test } from '@playwright/test';
import { completedSprint } from '../helpers/sprint';

for (const width of [1440, 390, 320]) {
  test(`REN keeps its size, changes color and fades below HOLD at width ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: width === 320 ? 'reduce' : 'no-preference' });
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
      for (const ren of [-1, 0, 1, 2, 3, 4, 8, 9, 13, 14, 18, 19, 40, 1000, -1]) {
        renderRen(sample, ren);
        const animation = sample.getAnimations()[0];
        renderRen(sample, ren);
        const sameAnimation = sample.getAnimations()[0] === animation;
        const opacity: number[] = [];
        const frames = animation ? (animation.effect as KeyframeEffect).getKeyframes() : [];
        if (animation) {
          animation.pause();
          const duration = Number(animation.effect!.getTiming().duration);
          for (const time of [0, duration / 2, duration]) {
            animation.currentTime = time;
            opacity.push(Number(getComputedStyle(sample).opacity));
          }
        }
        const style = getComputedStyle(sample);
        const box = sample.getBoundingClientRect();
        const board = document.querySelector('#board-0')!.getBoundingClientRect();
        const hold = document.querySelector('#hold-0')!.getBoundingClientRect();
        result.push({
          ren,
          hidden: sample.hidden,
          text: sample.textContent,
          size: parseFloat(getComputedStyle(sample.querySelector('strong')!).fontSize),
          color: style.color,
          background: style.backgroundImage,
          backgroundClip: style.backgroundClip,
          opacity,
          moves: frames.some((frame) => !!frame.transform),
          sameAnimation,
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
      renderRen(sample, 14);
      for (const animation of sample.getAnimations()) animation.finish();
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
        expect(item.size).toBeLessThanOrEqual(22);
        if (item.ren < 9) expect(item.size).toBe(22);
        const count = item.ren + 1;
        if (count >= 15) {
          expect(item.color).toBe('rgba(0, 0, 0, 0)');
          expect(item.background).toContain('linear-gradient');
          expect(item.backgroundClip).toBe('text');
        } else {
          expect(item.color).toBe(
            count >= 10
              ? 'rgb(255, 120, 134)'
              : count >= 5
                ? 'rgb(255, 225, 107)'
                : 'rgb(183, 239, 114)',
          );
          expect(item.background).toBe('none');
        }
        expect(item.opacity[0]).toBe(count === 2 ? 0 : 0.55);
        expect(item.opacity[1]).toBeGreaterThan(item.opacity[0]);
        expect(item.opacity[1]).toBeLessThan(1);
        expect(item.opacity[2]).toBe(1);
        expect(item.moves).toBe(width !== 320);
        expect(item.sameAnimation).toBe(true);
      }
    }
    const visible = sizes.filter((item) => !item.hidden);
    for (let i = 1; i < visible.length; i++) {
      expect(visible[i].size).toBeLessThanOrEqual(visible[i - 1].size);
      if (String(visible[i].ren + 1).length === String(visible[i - 1].ren + 1).length)
        expect(visible[i].size).toBe(visible[i - 1].size);
    }
    await page.screenshot({ path: `test-results/ren-rainbow-${width}.png` });
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
