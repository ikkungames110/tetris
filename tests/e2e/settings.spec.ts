import { expect, test } from '@playwright/test';

for (const width of [1440, 390, 360]) {
  test(`settings keep tabs on the left without moving them at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.locator('#settings-open').click();
    const tabs = page.getByRole('tablist', { name: '設定項目' });
    const before = await tabs.boundingBox();
    await page.getByRole('tab', { name: 'コントローラー', exact: true }).click();
    await expect(page.locator('#device-0')).toBeVisible();
    await page.locator('.settings-content').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.getByRole('tab', { name: '問い合わせ', exact: true }).click();
    await expect(
      page.locator('#contact-settings').getByRole('link', { name: 'aoigray110@gmail.com' }),
    ).toBeVisible();
    await expect(page.locator('#contact-settings a')).toHaveAttribute(
      'href',
      'mailto:aoigray110@gmail.com',
    );
    expect(await tabs.boundingBox()).toEqual(before);
    const panel = await page.locator('#contact-settings').boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(before!.x + before!.width);
    await page.getByRole('tab', { name: '問い合わせ', exact: true }).press('Home');
    await expect(page.getByRole('tab', { name: '音量', exact: true })).toBeFocused();
    await expect(page.locator('#bgm-volume')).toBeVisible();
    expect(
      await page
        .locator('#settings-dialog')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page
        .locator('.settings-content')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.locator('#settings-close').click();
    await page.locator('#mypage-open').click();
    await expect(page.locator('#mypage-dialog #replay-open')).toBeVisible();
    await expect(page.locator('#mypage-dialog #replay-save')).toBeVisible();
    if (width < 760) await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator('#mypage-dialog #replay-open')).toBeVisible();
  });
}

test('legal panels match the static pages, remain readable on mobile, and licenses are reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.locator('#settings-open').click();
  await page.locator('#terms-tab').click();
  await expect(page.locator('#terms-settings')).toContainText('開発者が独自に制作・運営');
  await expect(page.locator('#terms-settings')).not.toContainText(/Tetris|Holding|公式サイト/);
  for (const kind of ['terms', 'privacy', 'licenses']) {
    await page.locator(`#${kind}-tab`).click();
    await expect(page.locator(`#${kind}-settings`)).toBeVisible();
    expect(
      await page
        .locator('.settings-content')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
  const licenseLink = page
    .locator('#licenses-settings a')
    .filter({ hasText: 'サードパーティーライセンス全文' });
  const response = await page.request.get((await licenseLink.getAttribute('href'))!);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('Permission is hereby granted');
  expect(await response.text()).toContain('webrtc-adapter');
});

test('legal content and search metadata are available without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('footer')).toHaveCount(0);
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]']) {
      await expect(page.locator(selector)).toHaveAttribute('content', /手触りの良さを重視した/);
      await expect(page.locator(selector)).not.toHaveAttribute(
        'content',
        /独立開発|独自開発|非公式/,
      );
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://tetcla.shianstudio.com/',
    );
    await page.goto('/legal/#about');
    await expect(page.locator('#about')).toContainText('開発者が独自に制作・運営');
    await expect(page.locator('#privacy')).toContainText('i-mobile');
    await expect(page.locator('#licenses')).toContainText('AI');
    await expect(page.locator('body')).not.toContainText(/Tetris|Holding|公式サイト/);
    expect(await (await page.request.get('/legal/rajdhani.txt')).text()).toContain(
      'SIL OPEN FONT LICENSE',
    );
    expect((await page.request.get('/robots.txt')).ok()).toBe(true);
    expect(await (await page.request.get('/sitemap.xml')).text()).toContain(
      'https://tetcla.shianstudio.com/legal/',
    );
  } finally {
    await context.close();
  }
});
