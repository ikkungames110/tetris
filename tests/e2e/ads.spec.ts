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
    await expect(page.locator('.ad-slot > iframe')).toHaveCount(2);
    const ad = page.frameLocator('.ad-rail-right iframe');
    await expect(ad.getByText('広告配信待ち')).toBeVisible();
    await expect(ad.getByText('160 × 600')).toBeVisible();
    expect(await page.locator('.ad-rail-right iframe').boundingBox()).toMatchObject({
      width: 160,
      height: 600,
    });
    await page.getByRole('button', { name: 'プレイする' }).click();
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(page.locator('.ad-rail-left')).toBeHidden();
    await expect(page.locator('.ad-rail-right iframe')).toHaveCount(0);
    await expect(page.frameLocator('.mobile-ad iframe').getByText('広告配信待ち')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
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
    const ad = page.frameLocator('.ad-rail-right iframe');
    await expect(ad.getByText('広告配信待ち')).toBeVisible();
    await expect(ad.getByText('広告配信待ち')).toBeHidden();
    await expect(ad.locator('iframe, a > img')).toBeVisible();
  });
}

for (const width of [761, 1024, 1366, 1920]) {
  test(`PC幅${width}pxで指定の広告をゲームの左右に配置する`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1080 });
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
    await expect(page.locator('.ad-slot > iframe')).toHaveCount(2);
    for (const side of ['left', 'right']) {
      const frame = page.frameLocator(`.ad-rail-${side} > .ad-slot > iframe`);
      expect(await frame.locator('body').evaluate(() => location.href)).toBe(page.url());
      await expect(frame.locator('[id^="im-"]')).toHaveText(
        JSON.stringify({
          pid: 85394,
          mid: 596128,
          asid: 1943446,
          type: 'banner',
          display: 'inline',
          elementid: 'im-7b3d2a53f706423b904e60bcc78442ab',
        }),
      );
    }
    const left = (await page.locator('.ad-rail-left').boundingBox())!;
    const right = (await page.locator('.ad-rail-right').boundingBox())!;
    const main = (await page.locator('main').boundingBox())!;
    expect(left.x + left.width).toBeLessThanOrEqual(main.x);
    expect(right.x).toBeGreaterThanOrEqual(main.x + main.width);
    expect(left.y).toBe(right.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('スマホで指定のバナー広告を320×50の枠に読み込む', async ({ page }) => {
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
  const frame = page.frameLocator('.mobile-ad iframe');
  await expect(frame.locator('[id^="im-"]')).toHaveText(
    JSON.stringify({
      pid: 85394,
      mid: 596133,
      asid: 1943447,
      type: 'banner',
      display: 'inline',
      elementid: 'im-af44067cd22b47d48e15b2889c12bd3a',
    }),
  );
  expect(await page.locator('.mobile-ad iframe').boundingBox()).toMatchObject({
    width: 320,
    height: 50,
  });
});
