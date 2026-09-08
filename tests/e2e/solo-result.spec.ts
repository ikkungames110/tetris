import { expect, test, type Page } from '@playwright/test';

async function manualFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let callback: FrameRequestCallback;
    let frame = 0;
    Object.defineProperty(performance, 'now', { value: () => 0 });
    window.requestAnimationFrame = (fn) => {
      callback = fn;
      return 1;
    };
    Object.assign(window, {
      advance: (inputs: string) => {
        for (const key of inputs) {
          if (key === 'H') {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
          }
          callback(++frame * (1000 / 60 + 0.000001));
        }
      },
    });
  });
}
async function advance(page: Page, frames: string): Promise<void> {
  await page.evaluate(
    (frames) => (window as unknown as { advance: (s: string) => void }).advance(frames),
    frames,
  );
}
for (const mode of ['practice', 'sprint']) {
  test(`${mode}: GAME OVER stays on the board with save and restart, and freezes the run`, async ({
    page,
  }) => {
    await manualFrames(page);
    await page.goto('/');
    await page.locator(`#${mode}`).click();
    await page.locator('#start').click();
    await advance(page, '.'.repeat(181) + 'H'.repeat(30));
    await expect(page.locator('#solo-result')).toBeVisible();
    await expect(page.locator('#solo-result-title')).toHaveText('GAME OVER');
    await expect(page.locator('#solo-result-title')).toHaveCSS('color', 'rgb(255, 86, 107)');
    await expect(page.locator('#solo-result button')).toHaveCount(2);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('#board-overlay-0')).toBeHidden();
    const time = await page.locator('#timer').textContent();
    await advance(page, '.'.repeat(600));
    await expect(page.locator('#timer')).toHaveText(time!);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#solo-save').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    await page.locator('#solo-restart').click();
    await advance(page, '.');
    await expect(page.locator('#solo-result')).toBeHidden();
    await expect(page.locator('#board-overlay-0')).toHaveText('3');
    await expect(page.locator('#lines-0')).toHaveText('0');
    await expect(page.locator(`#${mode}`)).toHaveAttribute('aria-pressed', 'true');
  });
}

test('keyboard and the right-side button restart only after a one-second hold', async ({
  page,
}) => {
  await manualFrames(page);
  await page.goto('/');
  await expect(page.locator('#restart-key')).toHaveText('R');
  await page.locator('#start').click();
  await advance(page, '.'.repeat(181));
  await page.keyboard.down('r');
  await advance(page, '.'.repeat(20));
  await page.keyboard.up('r');
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await advance(page, '.');
  await page.keyboard.down('r');
  await advance(page, '.'.repeat(65));
  await expect(page.locator('#board-overlay-0')).toHaveText('3');
  await advance(page, '.'.repeat(250));
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await page.keyboard.up('r');
  await advance(page, '.');
  const hint = page.locator('#restart-hint');
  await hint.hover();
  await page.mouse.down();
  await advance(page, '.'.repeat(65));
  await page.mouse.up();
  await expect(page.locator('#board-overlay-0')).toHaveText('3');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(hint).toBeVisible();
  await expect(page.locator('#restart-key')).toHaveText('↻');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('a keyboard binding on R takes priority over the restart shortcut', async ({ page }) => {
  await manualFrames(page);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'stack-keyboard-v1',
      JSON.stringify({
        left: ['ArrowLeft'],
        right: ['ArrowRight'],
        soft: ['ArrowDown'],
        hard: ['Space'],
        ccw: ['KeyZ'],
        cw: ['KeyR'],
        hold: ['ShiftLeft'],
        pause: ['Escape'],
      }),
    );
  });
  await page.reload();
  await expect(page.locator('#restart-key')).toHaveText('Backspace');
  await page.locator('#start').click();
  await advance(page, '.'.repeat(181));
  await page.keyboard.down('r');
  await advance(page, '.'.repeat(90));
  await page.keyboard.up('r');
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await page.keyboard.down('Backspace');
  await advance(page, '.'.repeat(65));
  await page.keyboard.up('Backspace');
  await expect(page.locator('#board-overlay-0')).toHaveText('3');
});
