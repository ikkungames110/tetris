import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseReplay, ReplayPlayer } from '../../packages/core/replay';
import { Button, RULES } from '../../packages/core/types';

for (const mode of ['sprint']) {
  test(`${mode}: カウント中は操作せず、最初の操作tickから長押しを反映する`, async ({ page }) => {
    await page.addInitScript(() => {
      crypto.getRandomValues = <T extends ArrayBufferView | null>(values: T): T => {
        (values as unknown as Uint32Array).fill(17);
        return values;
      };
    });
    await page.goto('/');
    await page.locator(`#${mode}`).click();
    await page.locator('#start').click();
    await expect(page.locator('#board-overlay-0')).toContainText('3');
    for (const key of ['ArrowLeft', 'ArrowRight', 'KeyX', 'KeyZ', 'ShiftLeft', 'Space', 'Escape'])
      await page.keyboard.press(key);
    await expect(page.locator('#board-overlay-0')).toContainText('2');
    for (const key of ['ArrowRight', 'KeyX', 'Escape']) await page.keyboard.down(key);
    await expect(page.locator('#board-overlay-0')).toContainText('1');
    await expect(page.locator('#pps-0')).toHaveText('0.00');
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    await page.waitForTimeout(200);
    await expect(page.locator('#pps-0')).toHaveText('0.00');
    await page.locator('#pause').click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#mypage-open').click();
    await page.locator('#replay-save').click();
    const download = await downloadEvent;
    const record = parseReplay(await readFile((await download.path())!, 'utf8'));
    const frames = record.rounds[0].flatMap((run) =>
      Array.from({ length: run.ticks }, () => run.inputs[0]),
    );
    expect(frames.slice(0, RULES.countdown).every((i) => i.held === 0 && i.pressed === 0)).toBe(
      true,
    );
    expect(frames[RULES.countdown]).toEqual({
      held: Button.right | Button.cw,
      pressed: Button.right | Button.cw,
    });
    expect(frames.slice(RULES.countdown + 1).every((i) => i.pressed === 0)).toBe(true);
    const replay = new ReplayPlayer(record);
    while (!replay.done) replay.step();
    expect(replay.match.players[0].active!.x).toBeGreaterThan(3);
    expect(replay.match.players[0].active!.rotation).toBe(1);
    expect(replay.match.players[0].hold).toBeNull();
    expect(replay.valid).toBe(true);
    for (const key of ['ArrowRight', 'KeyX', 'Escape']) await page.keyboard.up(key);
    await page.locator('#mypage-close').click();
    await page.locator('#pause').click();
    await page.keyboard.press('Space');
    await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  });
}

test('タッチ操作はカウント中のタップを捨て、長押しは開始時に反映する', async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await page.goto('/');
    await page.locator('#sprint').tap();
    await page.locator('#start').tap();
    await expect(page.locator('#board-overlay-0')).toContainText('3');
    for (const button of await page.locator('.touch-key').all()) {
      await expect(button).toBeEnabled();
      const box = (await button.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(page.locator('#board-overlay-0')).toContainText('1');
    await expect(page.locator('#pps-0')).toHaveText('0.00');
    const session = await page.context().newCDPSession(page);
    const box = (await page.locator('[data-touch-action="hard"]').boundingBox())!;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
    });
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  } finally {
    await page.close();
  }
});

test('ゲームパッドの長押しも開始時に反映し、ポーズは持ち越さない', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { pressed: [] as number[] };
    Object.assign(window, { countdownPad: state });
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => [
        {
          id: 'Wireless Controller (054c:09cc)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 18 }, (_, i) => ({
            pressed: state.pressed.includes(i),
            value: state.pressed.includes(i) ? 1 : 0,
          })),
          axes: [0, 0, 0, 0],
          timestamp: performance.now(),
        },
      ],
    });
  });
  await page.goto('/');
  await expect(page.locator('#device-0')).toHaveValue('pad:0');
  await page.locator('#sprint').click();
  await page.locator('#start').click();
  await page.evaluate(() => {
    (window as unknown as { countdownPad: { pressed: number[] } }).countdownPad.pressed = [
      15, 3, 9,
    ];
  });
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await page.waitForTimeout(200);
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await page.evaluate(async () => {
    const state = (window as unknown as { countdownPad: { pressed: number[] } }).countdownPad;
    state.pressed = [];
    for (let i = 0; i < 3; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    state.pressed = [3];
  });
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
});

test('オンラインの両プレイヤーもカウント中は操作せず、長押しを開始時に反映する', async ({
  browser,
}) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await host.goto('/');
    await host.locator('#online').click();
    await host.locator('#room-create').click();
    await host.locator('#room-create-submit').click();
    await expect(host.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    await guest.goto(`/?room=${await host.locator('#room-code').textContent()}`);
    await guest.locator('#room-join').click();
    await host.locator('#room-ready').click();
    await guest.locator('#room-ready').click();
    await expect(guest.locator('#board-overlay-1')).toContainText('3');
    for (const page of [host, guest]) {
      await page.keyboard.press('ShiftLeft');
      await page.keyboard.press('KeyX');
      await page.keyboard.down('Space');
    }
    for (const page of [host, guest])
      for (const seat of [0, 1]) await expect(page.locator(`#pps-${seat}`)).toHaveText('0.00');
    await expect(host.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    await expect(guest.locator('#board-overlay-1')).toBeHidden({ timeout: 7000 });
    for (const page of [host, guest])
      for (const seat of [0, 1]) await expect(page.locator(`#pps-${seat}`)).not.toHaveText('0.00');
    for (const page of [host, guest]) {
      await page.keyboard.up('Space');
      await page.keyboard.press('Space');
    }
    for (const page of [host, guest])
      for (const seat of [0, 1]) await expect(page.locator(`#pps-${seat}`)).not.toHaveText('0.00');
  } finally {
    await host.close();
    await guest.close();
  }
});
