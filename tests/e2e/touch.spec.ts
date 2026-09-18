import { startSolo } from '../helpers/solo';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { Button } from '../../packages/core/types';
import { parseReplay, ReplayPlayer } from '../../packages/core/replay';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function start(page: Page) {
  await startSolo(page);
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
}

test('タッチの同時押し・短いタップ・キャンセルを記録し、リプレイでも再現できる', async ({
  page,
}) => {
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.goto('/');
  await start(page);
  const session = await page.context().newCDPSession(page);
  const point = async (action: string, id: number) => {
    const box = (await page.locator(`[data-touch-action="${action}"]`).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, id };
  };
  const left = await point('left', 1);
  const rotate = await point('cw', 2);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left] });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [left, rotate],
  });
  await page.waitForTimeout(180);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [rotate] });
  await expect(page.locator('[data-touch-action="left"]')).toHaveClass(/pressed/);
  await expect(page.locator('[data-touch-action="cw"]')).not.toHaveClass(/pressed/);
  await page.waitForTimeout(120);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.locator('.touch-key.pressed')).toHaveCount(0);
  const holdBefore = await page
    .locator('#hold-0')
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.getByRole('button', { name: 'ホールド', exact: true }).tap();
  await expect
    .poll(() => page.locator('#hold-0').evaluate((c: HTMLCanvasElement) => c.toDataURL()))
    .not.toBe(holdBefore);
  await page.getByRole('button', { name: '左回転', exact: true }).tap();
  await page.getByRole('button', { name: 'ハードドロップ', exact: true }).tap();
  await page.waitForTimeout(120);
  await page.getByRole('button', { name: '一時停止', exact: true }).tap();
  await expect(page.locator('.touch-key')).toHaveCount(7);
  await expect(page.locator('[data-touch-action="left"]')).toBeDisabled();
  await page.locator('#mypage-open').tap();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#replay-save').tap();
  const download = await downloadEvent;
  const replay = parseReplay(await readFile((await download.path())!, 'utf8'));
  const inputs = replay.rounds.flat().map((run) => run.inputs[0]);
  expect(
    inputs.some((i) => (i.held & (Button.left | Button.cw)) === (Button.left | Button.cw)),
  ).toBe(true);
  for (const action of [Button.left, Button.cw, Button.ccw, Button.hold, Button.hard])
    expect(inputs.some((i) => i.pressed & action)).toBe(true);
  expect(inputs.at(-1)!.held).toBe(0);
  const player = new ReplayPlayer(replay);
  while (!player.done) player.step();
  expect(player.valid).toBe(true);
});

test('標準配置は広告表示中もスマホの縦横切替とPCへの切替で操作と盤面を配置する', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('stack-touch-layout', 'standard'));
  const tags: string[] = [];
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => {
    tags.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await expect(page.locator('.bottom-ad iframe')).toHaveCount(1);
  await expect.poll(() => tags.length).toBe(1);
  await start(page);
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#touch-controls')).toBeVisible();
    await expect(page.locator('.site-header')).toBeVisible();
    await expect(page.locator('.player-stats').first()).toBeHidden();
    await expect(page.locator('#solo-controls')).toBeVisible();
    await expect(page.locator('.toolbar .bgm-picker')).toHaveCount(0);
    await expect(page.locator('.player-heading, #sound, #connection-status')).toHaveCount(0);
    await expect(page.locator('.bottom-ad iframe')).toHaveCount(1);
    const ad = (await page.locator('.bottom-ad iframe').first().boundingBox())!;
    expect(ad).toMatchObject({ width: 320, height: 50 });
    expect(ad.y + ad.height).toBeLessThanOrEqual(height);
    const board = (await page.locator('#board-0').boundingBox())!;
    expect(board.y + board.height).toBeLessThanOrEqual(ad.y);
    expect(Math.abs(board.x + board.width / 2 - width / 2)).toBeLessThanOrEqual(0.5);
    await expect(page.locator('#timer')).toBeHidden();
    if (height > width) {
      const dock = (await page.locator('.mobile-dock').boundingBox())!;
      expect(board.y + board.height).toBeLessThanOrEqual(dock.y);
      expect(board.height).toBeGreaterThan(height - 440 - 75);
    } else {
      // 広告欄の75px分だけ、停止中の盤面の最低高さから差し引く。
      expect(Math.round(board.height)).toBeGreaterThanOrEqual(152 - 75);
    }
    expect(board.y + board.height).toBeLessThanOrEqual(height - 8);
    for (const button of await page.locator('.touch-key').all()) {
      const box = (await button.boundingBox())!;
      expect(
        box.x + box.width <= board.x ||
          box.x >= board.x + board.width ||
          box.y >= board.y + board.height,
      ).toBe(true);
    }
    const ccw = (await page.locator('[data-touch-action="ccw"]').boundingBox())!;
    const cw = (await page.locator('[data-touch-action="cw"]').boundingBox())!;
    const hold = (await page.locator('[data-touch-action="hold"]').boundingBox())!;
    const left = (await page.locator('[data-touch-action="left"]').boundingBox())!;
    expect(cw.x).toBeGreaterThan(ccw.x);
    expect(cw.y).toBe(ccw.y);
    expect(left.x).toBeGreaterThanOrEqual(hold.x + hold.width);
    expect(hold.height).toBeGreaterThan(left.height);
    const drop = (await page.locator('[data-touch-action="hard"]').boundingBox())!;
    expect(drop.x).toBe(left.x);
    expect(drop.y + drop.height).toBeLessThanOrEqual(left.y);
    expect(ccw.height).toBe(hold.height);
    expect(
      await page.locator('.touch-left').evaluate((e) => getComputedStyle(e).borderRadius),
    ).not.toBe('50%');
    const buttons = await Promise.all(
      (await page.locator('.touch-key').all()).map((b) => b.boundingBox()),
    );
    for (let i = 0; i < buttons.length; i++) {
      const a = buttons[i]!;
      expect(a.y + a.height).toBeLessThanOrEqual(ad.y);
      for (const b of buttons.slice(i + 1)) {
        expect(
          a.x + a.width <= b!.x ||
            b!.x + b!.width <= a.x ||
            a.y + a.height <= b!.y ||
            b!.y + b!.height <= a.y,
        ).toBe(true);
      }
    }
    await page.screenshot({ path: `test-results/touch-${width}x${height}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await expect.poll(() => tags.length).toBe(1);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('#touch-controls')).toBeHidden();
  await expect(page.locator('.toolbar #bgm-select')).toBeVisible();
  await expect(page.locator('.player-stats').first()).toBeVisible();
  await expect(page.locator('.ad-slot > iframe')).toHaveCount(4);
  await expect.poll(() => tags.length).toBe(5);
});

test('スマホのタッチ操作がオンライン対戦の自分の盤面に反映される', async ({ page, browser }) => {
  const host = await browser.newPage({ viewport: { width: 1440, height: 1000 }, isMobile: false });
  try {
    for (const client of [host, page])
      await client.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
    await host.goto('/');
    await host.locator('#online').click();
    await host.locator('#room-create').click();
    await host.locator('#room-create-submit').click();
    await expect(host.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = await host.locator('#room-code').textContent();
    await page.goto('/');
    const solo = (await page.locator('#board-0').boundingBox())!;
    await page.goto(`/?room=${code}`);
    await page.locator('#room-join').tap();
    await expect(page.locator('#room-seat')).toContainText('2P');
    await expect(page.locator('#arena')).toBeHidden();
    await expect(host.locator('#arena')).toBeHidden();
    await host.locator('#room-ready').click();
    await page.locator('#room-ready').tap();
    await expect(page.locator('#arena')).toBeVisible();
    await expect(page.locator('#board-overlay-1')).toBeHidden({ timeout: 7000 });
    await page.getByRole('button', { name: 'ハードドロップ', exact: true }).tap();
    await expect(host.locator('#pps-1')).not.toHaveText('0.00');
    await expect(host.locator('#pps-0')).toHaveText('0.00');
    await page.getByRole('button', { name: 'ホールド', exact: true }).tap();
    await expect
      .poll(async () => {
        const images = await Promise.all(
          [host, page].map((client) =>
            client.locator('#hold-1').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
          ),
        );
        return images[0] === images[1];
      })
      .toBe(true);
    await page.screenshot({ path: 'test-results/touch-online.png' });
    const board = (await page.locator('#board-1').boundingBox())!;
    const dock = (await page.locator('.mobile-dock').boundingBox())!;
    expect(board.y + board.height).toBeLessThanOrEqual(dock.y);
    // 一人用と同じ盤面幅・中央位置を維持する。
    expect(board.width).toBeGreaterThanOrEqual(solo.width - 1);
    expect(Math.abs(board.x + board.width / 2 - 195)).toBeLessThan(1);
    const identity = (await page.locator('.player-1 > .player-identity').boundingBox())!;
    expect(identity.y + identity.height).toBeLessThanOrEqual(dock.y);
    expect(identity.x + identity.width).toBeLessThanOrEqual(board.x);
    const queue = (await page.locator('#next-1').boundingBox())!;
    expect(queue.y + queue.height).toBeLessThanOrEqual(dock.y);
    expect(queue.x).toBeGreaterThanOrEqual(board.x + board.width);
    const opponent = (await page.locator('#board-0').boundingBox())!;
    expect(opponent.width).toBeLessThanOrEqual(54);
    expect(opponent.y).toBeGreaterThanOrEqual(queue.y + queue.height);
    expect(opponent.x).toBeGreaterThanOrEqual(board.x + board.width);
    expect(opponent.x + opponent.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    for (const [width, height] of [
      [320, 568],
      [430, 932],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(async () => {
          const own = (await page.locator('#board-1').boundingBox())!;
          const other = (await page.locator('#board-0').boundingBox())!;
          const next = (await page.locator('#next-1').boundingBox())!;
          const controls = (await page.locator('.mobile-dock').boundingBox())!;
          return {
            ownAboveControls: own.y + own.height <= controls.y + 1,
            right: other.x >= own.x + own.width,
            belowQueue: other.y >= next.y + next.height,
            aboveControls: other.y + other.height <= controls.y + 1,
            queueAboveControls: next.y + next.height <= controls.y + 1,
          };
        })
        .toEqual({
          ownAboveControls: true,
          right: true,
          belowQueue: true,
          aboveControls: true,
          queueAboveControls: true,
        });
      const name = (await page.locator('.player-1 > .player-identity').boundingBox())!;
      const stock = (await page.locator('[data-touch-action="hold"]').boundingBox())!;
      expect(
        name.x + name.width <= stock.x ||
          name.x >= stock.x + stock.width ||
          name.y + name.height <= stock.y,
      ).toBe(true);
      await page.screenshot({ path: `test-results/versus-basic-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
    await host.setViewportSize({ width: 390, height: 844 });
    await expect(host.locator('.player-1.opponent-preview')).toBeVisible();
    const hostOwn = (await host.locator('#board-0').boundingBox())!;
    const hostOther = (await host.locator('#board-1').boundingBox())!;
    const hostQueue = (await host.locator('#next-0').boundingBox())!;
    expect(hostOwn.width).toBeGreaterThanOrEqual(solo.width - 1);
    expect(hostOther.y).toBeGreaterThanOrEqual(hostQueue.y + hostQueue.height);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator('#arena > .player-panel')).toHaveCount(2);
    await expect(page.locator('.opponent-preview')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#arena > .opponent-preview')).toBeVisible();
  } finally {
    await host.close();
  }
});

test('スマホのBGM選択は設定内で変更でき、画面幅を変えても保存される', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('stack-touch-layout', 'standard'));
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#bgm-select')).toBeHidden();
  await page.locator('#settings-open').tap();
  await expect(page.locator('#audio-settings #bgm-select')).toBeVisible();
  await page.locator('#bgm-select').selectOption('chess');
  await page.locator('#settings-close').tap();
  await page.reload();
  await page.locator('#settings-open').tap();
  await expect(page.locator('#bgm-select')).toHaveValue('chess');
  await page.locator('#settings-close').tap();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.toolbar #bgm-select')).toBeVisible();
  await expect(page.locator('#bgm-select')).toHaveValue('chess');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#bgm-select')).toBeHidden();
  await page.locator('#sprint').tap();
  await expect(page.locator('#personal-best')).toBeVisible();
  await start(page);
  const board = (await page.locator('#board-0').boundingBox())!;
  expect(board.height).toBeGreaterThan(390);
  for (const [width, height] of [
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#timer')).toBeVisible();
    await expect(page.locator('#personal-best')).toBeVisible();
    const board = (await page.locator('#board-0').boundingBox())!;
    expect(Math.abs(board.x + board.width / 2 - width / 2)).toBeLessThanOrEqual(0.5);
    const bottom = height > width ? (await page.locator('.mobile-dock').boundingBox())!.y : height;
    for (const selector of ['#personal-best', '#start', '#pause']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(board.y);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(bottom);
    }
  }
});

test('スマホのキーコンフィグはタッチと外部機器の設定を表示し、従来配置への切替を保存する', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#touch-controls')).toHaveAttribute('data-layout', 'stock-above');
  await page.locator('#settings-open').tap();
  await page.getByRole('tab', { name: 'キーコンフィグ', exact: true }).tap();
  await expect(page.locator('#touch-layout')).toBeVisible();
  await expect(page.locator('#hardware-settings')).toBeVisible();
  await page.locator('#touch-layout').selectOption('classic');
  await page.locator('#settings-close').tap();
  const hold = (await page.locator('[data-touch-action="hold"]').boundingBox())!;
  const left = (await page.locator('[data-touch-action="left"]').boundingBox())!;
  expect(left.x).toBe(hold.x);
  expect(hold.width).toBeGreaterThan(left.width);
  await page.reload();
  await expect(page.locator('#touch-controls')).toHaveAttribute('data-layout', 'classic');
  await page.locator('#settings-open').tap();
  await page.locator('#controller-tab').tap();
  await expect(page.locator('#touch-layout')).toHaveValue('classic');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#hardware-settings')).toBeVisible();
  await expect(page.locator('#touch-settings')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#hardware-settings')).toBeVisible();
  await page.locator('#touch-layout').selectOption('classic-swapped');
  await page.locator('#settings-close').tap();
  const swappedHold = (await page.locator('[data-touch-action="hold"]').boundingBox())!;
  const swappedDrop = (await page.locator('[data-touch-action="hard"]').boundingBox())!;
  const swappedLeft = (await page.locator('[data-touch-action="left"]').boundingBox())!;
  const rotate = (await page.locator('[data-touch-action="ccw"]').boundingBox())!;
  expect(swappedDrop.x).toBe(swappedLeft.x);
  expect(swappedHold.x).toBe(rotate.x);
  expect(swappedDrop.y).toBe(swappedHold.y);
  expect(swappedDrop.y + swappedDrop.height).toBeLessThan(swappedLeft.y);
  expect(swappedHold.y + swappedHold.height).toBeLessThan(rotate.y);
  await page.reload();
  await expect(page.locator('#touch-controls')).toHaveAttribute('data-layout', 'classic-swapped');
  await expect(page.locator('.touch-movement > [data-touch-action="hard"]')).toHaveCount(1);
  await expect(page.locator('.touch-placement > [data-touch-action="hold"]')).toHaveCount(1);
  await page.locator('#settings-open').tap();
  await page.locator('#controller-tab').tap();
  await expect(page.locator('#touch-layout')).toHaveValue('classic-swapped');
  await page.locator('#touch-layout').selectOption('classic');
  await expect(page.locator('.touch-movement > [data-touch-action="hold"]')).toHaveCount(1);
  await expect(page.locator('.touch-placement > [data-touch-action="hard"]')).toHaveCount(1);
  await page.locator('#touch-layout').selectOption('standard');
  await page.reload();
  await expect(page.locator('#touch-controls')).toHaveAttribute('data-layout', 'standard');
});

test('スマホは盤面上から再開し、左の正方形ボタンをタップしてリスタートできる', async ({ page }) => {
  await page.goto('/');
  await start(page);
  await page.locator('[data-touch-action="hard"]').tap();
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
  await expect(page.locator('#board-overlay-0')).not.toContainText('タブが非表示');
  await page.screenshot({ path: 'test-results/mobile-paused.png' });
  await page.locator('#board-resume').tap();
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  const board = (await page.locator('#board-0').boundingBox())!;
  const restart = (await page.locator('#restart-hint').boundingBox())!;
  expect(restart.x + restart.width).toBeLessThanOrEqual(board.x - 12);
  expect(restart.width).toBe(restart.height);
  expect(restart.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'リスタート', exact: true }).tap();
  await expect(page.locator('#pps-0')).toHaveText('0.00');
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await page.screenshot({ path: 'test-results/mobile-restart.png' });
});

test('STOCK上部の配置を保存し、縦横画面で盤面と重ならず操作できる', async ({ page }) => {
  await page.goto('/');
  await page.locator('#settings-open').tap();
  await page.locator('#controller-tab').tap();
  await page.locator('#touch-layout').selectOption('stock-above');
  await page.locator('#settings-close').tap();
  await page.reload();
  await expect(page.locator('#touch-controls')).toHaveAttribute('data-layout', 'stock-above');
  await start(page);
  for (const [width, height] of [
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () => {
        const board = (await page.locator('#board-0').boundingBox())!;
        const hold = (await page.locator('[data-touch-action="hold"]').boundingBox())!;
        return board.x - hold.x - hold.width;
      })
      .toBeGreaterThanOrEqual(8);
    const box = async (action: string) =>
      (await page.locator(`[data-touch-action="${action}"]`).boundingBox())!;
    const hold = await box('hold');
    const drop = await box('hard');
    const left = await box('left');
    const ccw = await box('ccw');
    const cw = await box('cw');
    expect(hold.width).toBe(64);
    expect(hold.height).toBe(64);
    expect(drop.y - hold.y - hold.height).toBeCloseTo(left.y - drop.y - drop.height, 1);
    await expect(page.locator('.touch-hold small')).toBeVisible();
    await expect(page.locator('.touch-up small')).toBeVisible();
    expect(drop.x).toBe(left.x);
    expect(drop.y + drop.height).toBeLessThan(left.y);
    expect(ccw.y).toBe(drop.y);
    expect(ccw.y + ccw.height).toBe(left.y + left.height);
    expect(cw.x).toBeGreaterThan(ccw.x + ccw.width);
    expect(hold.y).toBeGreaterThan(0);
    const restart = (await page.locator('#restart-hint').boundingBox())!;
    const dock = (await page.locator('.mobile-dock').boundingBox())!;
    expect(restart.y + restart.height).toBeLessThanOrEqual(dock.y);
    expect(
      restart.x + restart.width <= hold.x ||
        hold.x + hold.width <= restart.x ||
        restart.y + restart.height <= hold.y ||
        hold.y + hold.height <= restart.y,
    ).toBe(true);
    await page.screenshot({ path: `test-results/stock-above-${width}.png` });
  }
  const before = await page.locator('#hold-0').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.locator('[data-touch-action="hold"]').tap();
  await expect
    .poll(() => page.locator('#hold-0').evaluate((c: HTMLCanvasElement) => c.toDataURL()))
    .not.toBe(before);
  await page.locator('#settings-open').tap();
  await page.locator('#controller-tab').tap();
  await expect(page.locator('#touch-layout')).toHaveValue('stock-above');
  await page.locator('#touch-layout').selectOption('standard');
  await expect(page.locator('#touch-controls')).toHaveAttribute('data-layout', 'standard');
});

test('タッチパネルは対戦準備に残らず、一人用へ戻ると表示される', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.mobile-dock')).toBeVisible();
  await page.locator('#online').tap();
  await expect(page.locator('.mobile-dock')).toBeHidden();
  await page.locator('#match-start').tap();
  await expect(page.locator('#arena')).toBeHidden();
  await expect(page.locator('.mobile-dock')).toBeHidden();
  await page.locator('#practice').tap();
  await expect(page.locator('.mobile-dock')).toBeVisible();
  await expect(page.locator('[data-touch-action="hard"]')).toBeEnabled();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.mobile-dock')).toBeHidden();
});
