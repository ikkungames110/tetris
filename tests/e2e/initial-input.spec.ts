import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseReplay, ReplayPlayer } from '../../packages/core/replay';

test('最初に見えるフレームから先行した移動・回転を反映し、リプレイでも再現する', async ({
  page,
}) => {
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(() => {
    crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      (array as unknown as Uint32Array).fill(123);
      return array;
    };
    const overlay = document.querySelector<HTMLElement>('#board-overlay-0')!;
    const observer = new MutationObserver(() => {
      if (!overlay.hidden) return;
      const canvas = document.querySelector<HTMLCanvasElement>('#board-0')!;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
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
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('KeyX');
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  expect(
    await page.evaluate(
      () => (window as unknown as { firstPieceColumns: number[] }).firstPieceColumns,
    ),
  ).toEqual([4]);
  await page.locator('#pause').click();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#replay-save').click();
  const download = await downloadEvent;
  const replay = new ReplayPlayer(parseReplay(await readFile((await download.path())!, 'utf8')));
  while (replay.match.roundTicks === 0) replay.step();
  expect(replay.match.players[0].active).toMatchObject({ x: 2, rotation: 1 });
  while (!replay.done) replay.step();
  expect(replay.valid).toBe(true);
});

test('スマホでカウント中にタップしたドロップを開始時に一度だけ実行する', async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
    await page.goto('/');
    await page.locator('#start').tap();
    await expect(page.locator('#board-overlay-0')).toContainText('3');
    await page.locator('[data-touch-action="hard"]').tap();
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    await expect(page.locator('#pps-0')).not.toHaveText('0.00');
    await page.locator('#pause').tap();
    await page.locator('#settings-open').tap();
    await page.getByRole('tab', { name: 'リプレイ', exact: true }).tap();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#replay-save').tap();
    const replay = new ReplayPlayer(
      parseReplay(await readFile((await (await downloadEvent).path())!, 'utf8')),
    );
    while (!replay.done) replay.step();
    expect(replay.match.players[0].stats.pieces).toBe(1);
    expect(replay.valid).toBe(true);
  } finally {
    await page.close();
  }
});

test('設定を開いたらカウント中の先行入力を取り消す', async ({ page }) => {
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.goto('/');
  await page.locator('#start').click();
  await page.keyboard.press('Space');
  await page.locator('#settings-open').click();
  await page.locator('#settings-close').click();
  await page.locator('#pause').click();
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await expect(page.locator('#pps-0')).toHaveText('0.00');
});

test('ゲームパッドの短い先行ドロップも開始時に反映する', async ({ page }) => {
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.addInitScript(() => {
    const state = { pressed: false };
    Object.assign(window, { initialPad: state });
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => [
        {
          id: 'Wireless Controller (054c:09cc)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 18 }, (_, i) => ({
            pressed: i === 3 && state.pressed,
            value: i === 3 && state.pressed ? 1 : 0,
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
  await page.evaluate(async () => {
    const state = (window as unknown as { initialPad: { pressed: boolean } }).initialPad;
    state.pressed = true;
    for (let i = 0; i < 3; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    state.pressed = false;
  });
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
});

test('対戦の両プレイヤーがカウント中の短い入力を開始後に実行する', async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    for (const page of [host, guest])
      await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
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
    await host.keyboard.press('Space');
    await guest.keyboard.press('Space');
    await expect(host.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    await expect(host.locator('#pps-0')).not.toHaveText('0.00');
    await expect(host.locator('#pps-1')).not.toHaveText('0.00');
    await expect(guest.locator('#pps-1')).not.toHaveText('0.00');
  } finally {
    await host.close();
    await guest.close();
  }
});
