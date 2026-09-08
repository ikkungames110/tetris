import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseReplay, ReplayPlayer } from '../../packages/core/replay';

for (const mode of ['practice', 'sprint']) {
  test(`${mode}: 3・2・1中の連打と長押しを捨て、最初のミノを通常位置に出す`, async ({ page }) => {
    await page.goto('/');
    await page.locator(`#${mode}`).click();
    await page.evaluate(() => {
      crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
        (array as unknown as Uint32Array).fill(123);
        return array;
      };
      const overlay = document.querySelector<HTMLElement>('#board-overlay-0')!;
      const observer = new MutationObserver(() => {
        if (!overlay.hidden) return;
        const canvas = document.querySelector<HTMLCanvasElement>('#board-0')!;
        const pixels = canvas
          .getContext('2d')!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        const columns = new Set<number>();
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] === 0x60 && pixels[i + 1] === 0xd7 && pixels[i + 2] === 0xe9)
            columns.add(Math.floor(((i / 4) % canvas.width) / 30));
        Object.assign(window, { firstPieceColumns: [...columns] });
        observer.disconnect();
      });
      observer.observe(overlay, { attributes: true });
    });
    await page.locator('#start').click();
    await expect(page.locator('#board-overlay-0')).toContainText('3');
    for (const key of ['ArrowLeft', 'ArrowRight', 'KeyX', 'KeyZ', 'KeyC', 'Space', 'Escape'])
      await page.keyboard.press(key);
    await expect(page.locator('#board-overlay-0')).toContainText('2');
    for (const key of ['ArrowLeft', 'ArrowDown', 'KeyC', 'Space']) await page.keyboard.down(key);
    await expect(page.locator('#board-overlay-0')).toContainText('1');
    await page.keyboard.press('KeyX');
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    expect(
      await page.evaluate(
        () => (window as unknown as { firstPieceColumns: number[] }).firstPieceColumns,
      ),
    ).toEqual([3, 4, 5, 6]);
    // 開始後も押し続けたままにし、持ち越した移動やドロップがないことを確認する。
    await page.waitForTimeout(200);
    await expect(page.locator('#pps-0')).toHaveText('0.00');
    await page.locator('#pause').click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#replay-save').click();
    const download = await downloadEvent;
    const record = parseReplay(await readFile((await download.path())!, 'utf8'));
    expect(
      record.rounds
        .flat()
        .every((run) => run.inputs.every((input) => input.held === 0 && input.pressed === 0)),
    ).toBe(true);
    const replay = new ReplayPlayer(record);
    while (!replay.done) replay.step();
    expect(replay.match.players[0].active).toMatchObject({ x: 3, rotation: 0 });
    expect(replay.match.players[0].hold).toBeNull();
    expect(replay.valid).toBe(true);
    for (const key of ['ArrowLeft', 'ArrowDown', 'KeyC', 'Space']) await page.keyboard.up(key);
    await page.locator('#pause').click();
    await page.keyboard.press('Space');
    await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  });
}

test('タッチ操作はカウント中無効で、開始後の新しいタップだけを受け付ける', async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await page.goto('/');
    await page.locator('#start').tap();
    await expect(page.locator('#board-overlay-0')).toContainText('3');
    for (const button of await page.locator('.touch-key').all()) {
      await expect(button).toBeDisabled();
      const box = (await button.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    await expect(page.locator('#pps-0')).toHaveText('0.00');
    await page.locator('[data-touch-action="hard"]').tap();
    await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  } finally {
    await page.close();
  }
});

test('ゲームパッドのカウント中の長押しは、開始後に離して押し直すまで無効', async ({ page }) => {
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
  await page.locator('#start').click();
  await page.evaluate(() => {
    (window as unknown as { countdownPad: { pressed: number[] } }).countdownPad.pressed = [
      14, 0, 4, 3, 8, 9,
    ];
  });
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await page.waitForTimeout(200);
  await expect(page.locator('#pps-0')).toHaveText('0.00');
  await page.evaluate(async () => {
    const state = (window as unknown as { countdownPad: { pressed: number[] } }).countdownPad;
    state.pressed = [];
    for (let i = 0; i < 3; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    state.pressed = [3];
  });
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
});

test('オンラインの両プレイヤーもカウント中の操作を持ち越さない', async ({ browser }) => {
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
      await page.keyboard.press('KeyC');
      await page.keyboard.press('KeyX');
      await page.keyboard.down('Space');
    }
    await expect(host.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    await expect(guest.locator('#board-overlay-1')).toBeHidden({ timeout: 7000 });
    await guest.waitForTimeout(200);
    for (const page of [host, guest])
      for (const seat of [0, 1]) await expect(page.locator(`#pps-${seat}`)).toHaveText('0.00');
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
