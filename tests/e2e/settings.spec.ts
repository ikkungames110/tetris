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
    await expect(page.getByRole('link', { name: '問い合わせを開く' })).toBeVisible();
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
