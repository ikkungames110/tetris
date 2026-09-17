import { startSolo } from '../helpers/solo';
import { expect, test } from '@playwright/test';

const adTag = 'https://imp-adedge.i-mobile.co.jp/script/v1/spot.js?20220104';

for (const response of ['no_ad', 'blocked']) {
  test(`広告が${response}でも仮表示とゲーム操作を維持する`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.route(adTag, (route) =>
      response === 'blocked'
        ? route.abort()
        : route.fulfill({
            contentType: 'application/javascript',
            // no_ad応答でも挿入される計測用画像は、配信広告として扱わない。
            body: `document.body.insertAdjacentHTML('beforeend', '<img width="1" height="1" style="display:none">');`,
          }),
    );
    await page.goto('/');
    await expect(page.locator('.ad-slot > iframe')).toHaveCount(4);
    const ad = page.frameLocator('.bottom-ad iframe').first();
    await expect(ad.getByText('広告配信待ち')).toBeVisible();
    expect(await page.locator('.bottom-ad iframe').first().boundingBox()).toMatchObject({
      width: 320,
      height: 50,
    });
    await startSolo(page);
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(page.locator('.bottom-ad iframe')).toHaveCount(1);
  });
}

for (const creative of [
  '<iframe width="160" height="600" srcdoc="<p>配信テスト</p>"></iframe>',
  '<a href="https://example.com"><img width="160" height="600" alt="配信テスト"></a>',
]) {
  test(`広告配信後は仮表示を消す: ${creative.startsWith('<iframe') ? 'HTML' : '画像'}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.route(adTag, (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `setTimeout(() => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(creative)}), 500);`,
      }),
    );
    await page.goto('/');
    const ad = page.frameLocator('.bottom-ad iframe').first();
    await expect(ad.getByText('広告配信待ち')).toBeVisible();
    await expect(ad.getByText('広告配信待ち')).toBeHidden();
    await expect(ad.locator('iframe, a > img')).toBeVisible();
  });
}

for (const width of [761, 1024, 1366, 1920]) {
  test(`PC幅${width}pxで指定の広告を画面下部に横並びで配置する`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await page.route(adTag, (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `for (const ad of window.adsbyimobile) {
          const slot = document.getElementById(ad.elementid);
          slot.textContent = JSON.stringify(ad);
        }`,
      }),
    );
    await page.goto('/');
    await expect(page.locator('.ad-slot > iframe')).toHaveCount(4);
    for (const side of ['left', 'right']) {
      const frame = page.frameLocator(`.ad-rail-${side} iframe`);
      await expect(frame.locator('[id^="im-"]')).toHaveText(
        JSON.stringify({
          pid: 85394,
          mid: 596128,
          asid: side === 'left' ? 1943446 : 1945424,
          type: 'banner',
          display: 'inline',
          elementid:
            side === 'left'
              ? 'im-b3fdf6aeade64c26b5dc16f189271f61'
              : 'im-2291b862c26f4ae6a3a41e2f1f119ccc',
        }),
      );
      const box = (await page.locator(`.ad-rail-${side} iframe`).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(701);
    }
    for (const index of [0, 1]) {
      const frame = page.frameLocator('.bottom-ad iframe').nth(index);
      expect(await frame.locator('body').evaluate(() => location.href)).toBe(page.url());
      await expect(frame.locator('[id^="im-"]')).toHaveText(
        JSON.stringify({
          pid: 85394,
          mid: 596128,
          asid: index === 0 ? 1944749 : 1945423,
          type: 'banner',
          display: 'inline',
          elementid:
            index === 0
              ? 'im-be31bf9955f64191816ad3553f140078'
              : 'im-1b2a9745020a4f789e3d81d552528fdd',
        }),
      );
    }
    const [left, right] = await Promise.all([
      page.locator('.bottom-ad iframe').first().boundingBox(),
      page.locator('.bottom-ad iframe').nth(1).boundingBox(),
    ]);
    expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
    expect(left!.y).toBe(right!.y);
    expect(right!.y + right!.height).toBeLessThanOrEqual(768);
    expect(right!.x + right!.width).toBeLessThanOrEqual(width);
    const board = (await page.locator('#board-0').boundingBox())!;
    expect(board.y + board.height).toBeLessThanOrEqual(left!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('スマホで指定のバナー広告を下部に1枠だけ読み込む', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route(adTag, (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `for (const ad of window.adsbyimobile) {
        const slot = document.getElementById(ad.elementid);
        slot.textContent = JSON.stringify(ad);
      }`,
    }),
  );
  await page.goto('/');
  await expect(page.locator('.ad-slot > iframe')).toHaveCount(1);
  await expect(page.locator('.bottom-ad iframe')).toHaveCount(1);
  for (const frame of [page.frameLocator('.bottom-ad iframe').first()])
    await expect(frame.locator('[id^="im-"]')).toHaveText(
      JSON.stringify({
        pid: 85394,
        mid: 596133,
        asid: 1943447,
        type: 'banner',
        display: 'inline',
        elementid: 'im-79fdebb4d3e248a6a9efc2b27ba13d85',
      }),
    );
});
