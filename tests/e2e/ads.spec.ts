import { startSolo } from '../helpers/solo';
import { expect, test } from '@playwright/test';

const desktopAdTag = 'https://j.zucks.net.zimg.jp/j?f=736747';

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
    await expect(page.locator('.ad-slot > iframe')).toHaveCount(21);
    const ad = page.frameLocator('.bottom-ad iframe').first();
    await expect(ad.getByText('広告配信待ち')).toBeVisible();
    expect(await page.locator('.bottom-ad iframe').first().boundingBox()).toMatchObject({
      width: 728,
      height: 90,
    });
    await startSolo(page);
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(page.locator('.bottom-ad iframe')).toHaveCount(1);
    expect(await page.locator('.bottom-ad iframe').boundingBox()).toMatchObject({
      width: 320,
      height: 50,
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('.ad-slot > iframe')).toHaveCount(21);
    await expect(page.locator('.bottom-ad iframe')).toHaveCount(1);
    expect(await page.locator('.bottom-ad iframe').boundingBox()).toMatchObject({
      width: 728,
      height: 90,
    });
  });
}

for (const creative of [
  '<iframe width="468" height="60" srcdoc="<p>配信テスト</p>"></iframe>',
  '<a href="https://example.com"><img width="468" height="60" alt="配信テスト"></a>',
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
    for (const selector of [
      '.bottom-ad iframe',
      '.ad-rail-left .ad-slot > iframe',
      '.ad-rail-right .ad-slot > iframe',
    ]) {
      const ad = page.frameLocator(selector).first();
      await expect(ad.getByText('広告配信待ち')).toBeHidden();
      await expect(ad.locator('iframe, a > img')).toBeVisible();
    }
    expect(
      await page.locator('.ad-rail-left .ad-slot > iframe').first().boundingBox(),
    ).toMatchObject({ width: 468, height: 60 });
  });
}

for (const width of [761, 1024, 1366, 1920]) {
  test(`PC幅${width}pxで左右にバナーを10枠ずつ隙間なく配置し、下部の1枠を維持する`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await page.route(adTag, (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `for (const ad of window.adsbyimobile) {
          const slot = document.getElementById(ad.elementid);
          slot.append(Object.assign(document.createElement('span'), { textContent: JSON.stringify(ad) }));
        }`,
      }),
    );
    await page.goto('/');
    await expect(page.locator('.ad-slot > iframe')).toHaveCount(21);
    const asids: number[] = [];
    const elementIds: string[] = [];
    for (const side of ['left', 'right']) {
      const frames = page.locator(`.ad-rail-${side} .ad-slot > iframe`);
      await expect(frames).toHaveCount(10);
      let previousBottom: number | undefined;
      for (let index = 0; index < 10; index++) {
        const frame = frames.nth(index).contentFrame();
        await expect(frame.locator('script[src]')).toHaveAttribute('src', adTag);
        await expect(frames.nth(index)).toHaveAttribute('width', '468');
        await expect(frames.nth(index)).toHaveAttribute('height', '60');
        const tag = JSON.parse(await frame.locator('[id^="im-"] > span').innerText());
        expect(tag).toMatchObject({ pid: 85394, mid: 596128, type: 'banner', display: 'inline' });
        asids.push(tag.asid);
        elementIds.push(tag.elementid);
        const box = (await frames.nth(index).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(661);
        if (previousBottom !== undefined) expect(box.y).toBeCloseTo(previousBottom, 3);
        previousBottom = box.y + box.height;
      }
    }
    expect(asids).toEqual([1944749, 1945423, ...Array.from({ length: 18 }, (_, i) => 1945549 + i)]);
    expect(new Set(elementIds).size).toBe(20);
    await expect(page.locator('.bottom-ad iframe')).toHaveCount(1);
    const frame = page.frameLocator('.bottom-ad iframe');
    expect(await frame.locator('body').evaluate(() => location.href)).toBe(page.url());
    await expect(frame.locator('[id^="im-"] > span')).toHaveText(
      JSON.stringify({
        pid: 85394,
        mid: 596128,
        asid: 1945489,
        type: 'banner',
        display: 'inline',
        elementid: 'im-9905c2e5068d48b9a7071994203e52b6',
      }),
    );
    const bottom = (await page.locator('.bottom-ad iframe').boundingBox())!;
    expect(bottom).toMatchObject({ width: 728, height: 90 });
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(768);
    expect(bottom.x).toBeGreaterThanOrEqual(0);
    expect(bottom.x + bottom.width).toBeLessThanOrEqual(width);
    expect(bottom.x + bottom.width / 2).toBeCloseTo(width / 2, 0);
    const board = (await page.locator('#board-0').boundingBox())!;
    expect(board.y + board.height).toBeLessThanOrEqual(bottom.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('スマホで指定のバナー広告を下部に1枠だけ読み込む', async ({ page }) => {
  const desktopRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url() === desktopAdTag) desktopRequests.push(request.url());
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route(adTag, (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `for (const ad of window.adsbyimobile) {
        const slot = document.getElementById(ad.elementid);
        slot.append(Object.assign(document.createElement('span'), { textContent: JSON.stringify(ad) }));
      }`,
    }),
  );
  await page.goto('/');
  await expect(page.locator('.ad-slot > iframe')).toHaveCount(1);
  expect(desktopRequests).toEqual([]);
  await expect(page.locator('.bottom-ad iframe')).toHaveCount(1);
  for (const frame of [page.frameLocator('.bottom-ad iframe').first()])
    await expect(frame.locator('[id^="im-"] > span')).toHaveText(
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
