import { expect, test } from '@playwright/test';

const adTag = 'https://j.zucks.net.zimg.jp/j?f=736747';

for (const response of ['no_ad', 'blocked']) {
  test(`広告が${response}でも仮表示とゲーム操作を維持する`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.route(adTag, (route) =>
      response === 'blocked'
        ? route.abort()
        : route.fulfill({
            contentType: 'application/javascript',
            // no_ad応答でも挿入される計測用画像は、配信広告として扱わない。
            body: `document.write('<img width="1" height="1" style="display:none">');`,
          }),
    );
    await page.goto('/');
    await expect(page.locator('.ad-slot > iframe')).toHaveCount(2);
    const ad = page.frameLocator('.ad-rail-right iframe');
    await expect(ad.getByText('広告配信待ち')).toBeVisible();
    await expect(ad.getByText('360 × 540')).toBeVisible();
    expect(await page.locator('.ad-rail-right iframe').boundingBox()).toMatchObject({
      width: 360,
      height: 540,
    });
    await page.getByRole('button', { name: 'プレイする' }).click();
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
    await page.setViewportSize({ width: 320, height: 844 });
    await page.locator('.ad-rail-right').scrollIntoViewIfNeeded();
    await expect(page.locator('.ad-rail-left')).toBeHidden();
    await expect(ad.getByText('広告配信待ち')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
}

for (const creative of [
  '<iframe width="360" height="540" srcdoc="<p>配信テスト</p>"></iframe>',
  '<a href="https://example.com"><img width="360" height="540" alt="配信テスト"></a>',
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
