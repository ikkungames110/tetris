import { expect, test } from '@playwright/test';

for (const width of [1440, 360, 320]) {
  test(`ヘルプを設定の右から開き、ゲームを止めたまま読める: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const settings = (await page.locator('#settings-open').boundingBox())!;
    const help = (await page.locator('#help-open').boundingBox())!;
    expect(help.x).toBeGreaterThanOrEqual(settings.x + settings.width);
    expect(Math.abs(help.y - settings.y)).toBeLessThanOrEqual(1);
    await page.locator('#help-open').click();
    await expect(page.locator('#help-dialog')).toBeVisible();
    for (const title of [
      'Tスピン / T spin mini',
      'REN（連続ライン消去）',
      'リプレイの保存・再生',
      'コントローラーのボタン割り当て',
    ])
      await expect(
        page.locator('#help-dialog').getByRole('heading', { name: title }),
      ).toBeVisible();
    const before = await page
      .locator('#board-0')
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    expect(
      await page.locator('#board-0').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    ).toBe(before);
    expect(
      await page
        .locator('#help-dialog')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#help-dialog')).toBeHidden();
    await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
    await page.locator('#pause').click();
    await expect(page.locator('#board-overlay-0')).toBeHidden();
  });
}

test('マイページで読み込みエラーを確認し、正しいファイルを選び直して再生できる', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#mypage-open').click();
  await page.locator('#replay-file').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(page.locator('#replay-status')).toBeVisible();
  await expect(page.locator('#mypage-dialog')).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#replay-save').click();
  const download = await downloadEvent;
  const chooserEvent = page.waitForEvent('filechooser');
  await page.locator('#replay-open').click();
  await (await chooserEvent).setFiles((await download.path())!);
  await expect(page.locator('#mypage-dialog')).toBeHidden();
  await expect(page.locator('#notice')).toContainText('記録と盤面の一致', { timeout: 10000 });
});
