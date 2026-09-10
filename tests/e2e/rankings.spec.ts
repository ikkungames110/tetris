import { expect, test } from '@playwright/test';

for (const width of [1440, 360, 320]) {
  test(`ランキングは上位10人と圏外の自分を表示し、切り替えで通信しない: ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/')) requests.push(new URL(request.url()).pathname);
    });
    await page.route('**/api/v1/session', async (route) => {
      const response = await route.fetch();
      const state = await response.json();
      const top = Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        name: i === 0 ? '<img src=x onerror=alert(1)>' : `プレイヤー${i + 1}`,
        value: 600 + i * 60,
        isYou: false,
      }));
      await route.fulfill({
        response,
        json: {
          ...state,
          rankings: {
            sprint: { top, mine: { rank: 13, value: 1800 } },
            random: {
              top: top.map((entry, i) => ({ ...entry, value: 2000 - i * 10 })),
              mine: null,
            },
          },
        },
      });
    });
    await page.goto('/');
    await expect(page.locator('#ranking-status')).toHaveText('');
    await page.locator('#ranking-open').click();
    await expect(page.locator('#ranking-sprint-rows tr')).toHaveCount(10);
    await expect(page.locator('#ranking-sprint-rows tr').first()).toContainText('00:10.000');
    await expect(page.locator('#ranking-sprint-mine')).toContainText('13位');
    await expect(page.locator('#ranking-sprint-mine')).toContainText('00:30.000');
    await expect(page.locator('#ranking-dialog img')).toHaveCount(0);
    for (let i = 0; i < 3; i++) {
      await page.locator('#ranking-random-tab').click();
      await expect(page.locator('#ranking-random-rows tr')).toHaveCount(10);
      await expect(page.locator('#ranking-random-rows tr').first()).toContainText('2000');
      await expect(page.locator('#ranking-random-mine')).toContainText('ログインすると');
      await page.locator('#ranking-random-tab').press('ArrowLeft');
      await expect(page.locator('#ranking-sprint-tab')).toBeFocused();
    }
    const tabs = await page.locator('.ranking-tabs').boundingBox();
    const panel = await page.locator('#ranking-sprint').boundingBox();
    expect(tabs!.y + tabs!.height).toBeLessThanOrEqual(panel!.y);
    expect(
      await page.locator('#ranking-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ranking-dialog')).toBeHidden();
    await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
    await page.locator('#ranking-open').click();
    await expect(page.locator('#ranking-sprint-mine')).toContainText('13位');
    expect(requests).toEqual(['/api/v1/session']);
  });
}

test('ランキングの取得失敗は画面に表示し、開き直しても自動再送しない', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/v1/session', (route) => {
    calls++;
    return route.abort();
  });
  await page.goto('/');
  await page.locator('#ranking-open').click();
  await expect(page.locator('#ranking-status')).toContainText('取得できませんでした');
  await page.locator('#ranking-close').click();
  await page.locator('#ranking-open').click();
  expect(calls).toBe(1);
});

test('登録・ログインで順位が反映され、ログアウト後は自分の表示が残らない', async ({ page }) => {
  await page.goto('/');
  await page.locator('#login-open').click();
  await page.locator('#account-register').click();
  const email = `ranking-${Date.now()}@example.test`;
  await page.locator('#account-email').fill(email);
  await page.locator('#account-password').fill('a');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-dialog')).toBeHidden();
  await page.locator('#ranking-open').click();
  await page.locator('#ranking-random-tab').click();
  await expect(page.locator('#ranking-random-mine')).toContainText('位');
  await page.locator('#ranking-close').click();
  await page.locator('#login-open').click();
  await page.locator('#account-logout').click();
  await expect(page.locator('#account-dialog')).toBeHidden();
  await page.locator('#ranking-open').click();
  await expect(page.locator('#ranking-random-mine')).toContainText('ログインすると');
  await expect(page.locator('#ranking-random-rows .is-you')).toHaveCount(0);
  await page.locator('#ranking-close').click();
  await page.locator('#login-open').click();
  await page.locator('#account-email').fill(email);
  await page.locator('#account-password').fill('a');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-dialog')).toBeHidden();
  await page.locator('#ranking-open').click();
  await expect(page.locator('#ranking-random-mine')).toContainText('位');
});
