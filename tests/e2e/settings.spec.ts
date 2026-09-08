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
    if (width < 760) {
      await page.getByRole('tab', { name: 'リプレイ', exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(page.locator('#audio-tab')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#replay-tab')).toBeHidden();
    }
  });
}

test('legal panels match the static pages, remain readable on mobile, and licenses are reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.locator('#settings-open').click();
  await page.locator('#terms-tab').click();
  await expect(page.locator('#terms-settings')).toContainText('独立して開発');
  await expect(page.locator('#terms-settings')).toContainText('承認その他の関係はありません');
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
    await expect(page.locator('.site-info')).toContainText('独立開発');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://tetcla.shianstudio.com/',
    );
    await page.getByRole('link', { name: '利用規約・権利表記' }).click();
    await expect(page.locator('#about')).toContainText('Tetrisの公式作品・移植版ではなく');
    await expect(page.locator('#privacy')).toContainText('i-mobile');
    await expect(page.locator('#licenses')).toContainText('AI');
    expect((await page.request.get('/robots.txt')).ok()).toBe(true);
    expect(await (await page.request.get('/sitemap.xml')).text()).toContain(
      'https://tetcla.shianstudio.com/legal/',
    );
  } finally {
    await context.close();
  }
});
