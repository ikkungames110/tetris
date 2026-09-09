import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('a named host can choose one win, keep the room on mobile and start a new match', async ({
  browser,
}) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  try {
    await a.goto('/');
    await a.locator('#login-open').click();
    await a.locator('#account-register').click();
    const name = `tetris-${randomUUID().slice(0, 8)}`;
    await a.locator('#account-email').fill(`${name}@example.test`);
    await a.locator('#account-password').fill('a');
    await a.locator('#account-submit').click();
    await expect(a.locator('#account-dialog')).toBeHidden();
    await a.locator('#online').click();
    await a.locator('#room-create').click();
    await a.locator('#room-wins').selectOption('1');
    await a.locator('#room-create-submit').click();
    await expect(a.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = await a.locator('#room-code').textContent();
    await b.setViewportSize({ width: 390, height: 844 });
    await b.goto(`/?room=${code}`);
    await b.locator('#room-join').click();
    await expect(b.locator('#room-code')).toHaveText(code!);
    for (const page of [a, b]) {
      await expect(page.locator('#player-name-0')).toHaveText(name);
      await expect(page.locator('#player-name-1')).toHaveText('ゲスト');
      await expect(page.locator('#player-wins-0')).toHaveText('☆');
      await page.locator('#room-ready').click();
    }
    await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    await expect(b.locator('#board-overlay-1')).toBeHidden();
    await expect(b.locator('#player-name-0')).toBeVisible();
    await expect(b.locator('#player-name-1')).toBeVisible();
    const own = (await b.locator('#board-1').boundingBox())!;
    const opponent = (await b.locator('#board-0').boundingBox())!;
    expect(own.x + own.width).toBeLessThanOrEqual(opponent.x);
    for (let i = 0; i < 30 && !(await a.locator('#board-overlay-0').isVisible()); i++) {
      await a.keyboard.press('Space');
      await a.waitForTimeout(70);
    }
    await expect(a.locator('#board-overlay-0 > span')).toHaveText('LOSE');
    await expect(b.locator('#player-wins-1')).toHaveText('★');
    await expect(b.locator('#result-dialog')).toBeVisible();
    await expect(b.locator('#result-title')).toHaveText('WIN');
    await b.locator('#result-home').click();
    await expect(b.locator('#room-ready')).toBeVisible();
    await expect(b.locator('#room-code')).toHaveText(code!);
    expect(await b.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await b.locator('#room-ready').click();
    await a.locator('#result-next').click();
    await expect(b.locator('#player-wins-1')).toHaveText('☆');
    await expect(b.locator('#board-overlay-1')).toBeHidden({ timeout: 7000 });
    await expect(b.locator('#room-code')).toHaveText(code!);
    await b.screenshot({ path: 'test-results/versus-names-mobile.png' });
  } finally {
    await a.close();
    await b.close();
  }
});

test('idle P2P rooms survive silent heartbeats and a suspended host timer', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  for (const page of [a, b]) {
    await page.addInitScript(() => {
      const send = RTCDataChannel.prototype.send as (
        data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer> | Blob,
      ) => void;
      RTCDataChannel.prototype.send = function (data) {
        if (typeof data === 'string' && JSON.parse(data).type === 'ping') return;
        return send.call(this, data);
      };
    });
  }
  await a.addInitScript(() => {
    const now = performance.now.bind(performance);
    const state = { offset: 0 };
    Object.assign(window, { hostClock: state });
    Object.defineProperty(performance, 'now', { value: () => now() + state.offset });
  });
  try {
    await a.goto('/');
    await a.locator('#online').click();
    await a.locator('#room-create').click();
    await a.locator('#room-create-submit').click();
    await expect(a.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = await a.locator('#room-code').textContent();
    await b.goto(`/?room=${code}`);
    await b.locator('#room-join').click();
    await expect(b.locator('#room-code')).toHaveText(code!);
    await a.evaluate(() => {
      (window as unknown as { hostClock: { offset: number } }).hostClock.offset = 35 * 60_000;
    });
    await a.waitForTimeout(7500);
    for (const page of [a, b]) {
      await expect(page.locator('#result-dialog')).toBeHidden();
      await expect(page.locator('#room-code')).toHaveText(code!);
      await page.locator('#room-ready').click();
    }
    await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    await expect(b.locator('#board-overlay-1')).toBeHidden();
  } finally {
    await a.close();
    await b.close();
  }
});
