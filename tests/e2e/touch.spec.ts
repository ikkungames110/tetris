import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { Button } from '../../packages/core/types';
import { parseReplay, ReplayPlayer } from '../../packages/core/replay';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function start(page: Page) {
  await page.getByRole('button', { name: 'プレイする' }).tap();
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
  await page.locator('#replay-save').evaluate((e) => e.scrollIntoView({ block: 'start' }));
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

test('スマホの縦横切替とPCへの切替で操作・広告を出し分ける', async ({ page }) => {
  const tags: string[] = [];
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => {
    tags.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await expect(page.locator('.mobile-ad iframe')).toHaveCount(1);
  await expect(page.locator('.ad-rail-left iframe, .ad-rail-right iframe')).toHaveCount(0);
  expect(tags).toEqual(['https://imp-adedge.i-mobile.co.jp/script/v1/spot.js?20220104']);
  await start(page);
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#touch-controls')).toBeVisible();
    await expect(page.locator('.mobile-ad iframe')).toHaveAttribute('width', '320');
    const board = (await page.locator('#board-0').boundingBox())!;
    const ad = (await page.locator('.mobile-ad').boundingBox())!;
    expect(board.y + board.height).toBeLessThanOrEqual(ad.y);
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
    expect(cw.y).toBeLessThan(ccw.y);
    expect(hold.width).toBeGreaterThan(left.width);
    expect(left.x).toBeGreaterThan(hold.x);
    expect(
      await page.locator('.touch-left').evaluate((e) => getComputedStyle(e).borderRadius),
    ).toBe('50%');
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
  expect(tags).toEqual(['https://imp-adedge.i-mobile.co.jp/script/v1/spot.js?20220104']);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('#touch-controls')).toBeHidden();
  await expect(page.locator('.mobile-ad iframe')).toHaveCount(0);
  await expect(page.locator('.ad-slot > iframe')).toHaveCount(2);
  await expect.poll(() => tags.length).toBe(3);
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
    await page.goto(`/?room=${code}`);
    await page.locator('#room-join').tap();
    await expect(page.locator('#room-seat')).toContainText('2P');
    await host.locator('#room-ready').click();
    await page.locator('#room-ready').tap();
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
  } finally {
    await host.close();
  }
});
