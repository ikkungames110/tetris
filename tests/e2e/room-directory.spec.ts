import { expect, test } from '@playwright/test';

test('find a locked room in the list and join after correcting the password', async ({
  browser,
}) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await host.goto('/');
    await host.locator('#online').click();
    await host.locator('#room-create').click();
    await host.locator('#room-password-mode').selectOption('locked');
    await host.locator('#room-password').fill('123');
    await host.locator('#room-create-submit').click();
    await expect(host.locator('#room-code')).toBeEmpty();
    await host.locator('#room-password').fill('0123');
    const registered = host.waitForResponse(
      (r) => r.url().endsWith('/api/v1/rooms') && r.request().method() === 'POST',
    );
    await host.locator('#room-create-submit').click();
    expect((await registered).ok()).toBeTruthy();
    const code = await host.locator('#room-code').textContent();
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.goto('/');
    await guest.locator('#online').click();
    await guest.locator('#room-join-open').click();
    await guest.locator('.room-list-item').filter({ hasText: 'パスワードあり' }).click();
    await guest.screenshot({ path: 'test-results/room-list-mobile.png' });
    await guest.locator('#room-join-password').fill('9999');
    await guest.locator('#room-join').click();
    await expect(guest.locator('#notice')).toContainText('パスワードが違います');
    const selectedId = await guest.locator('#room-code-input').inputValue();
    await guest.locator('#room-join-password').fill('0123');
    await guest.locator('#room-join').click();
    await expect(guest.locator('#room-code')).toHaveText(code!);
    expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await expect
      .poll(async () => {
        const response = await guest.request.get('/api/v1/rooms');
        return (await response.json()).rooms.some((room: { id: string }) => room.id === selectedId);
      })
      .toBe(false);
  } finally {
    await host.close();
    await guest.close();
  }
});

test('room list fetches only on open and manual refresh', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/v1/rooms', async (route) => {
    if (route.request().method() === 'GET') {
      reads++;
      await route.fulfill({
        json: {
          rooms: [
            { id: 'open-room', name: '<test>', winsRequired: 3, locked: false, handicap: null },
          ],
        },
      });
    } else await route.continue();
  });
  await page.goto('/');
  await page.locator('#online').click();
  await page.locator('#room-join-open').click();
  await expect(page.locator('.room-list-item')).toContainText('<test>');
  await page.locator('.room-list-item').click();
  await expect(page.locator('#room-join-password')).toBeHidden();
  await page.clock.install();
  await page.clock.fastForward(120_000);
  expect(reads).toBe(1);
  await page.locator('#room-refresh').click();
  await expect.poll(() => reads).toBe(2);
});
