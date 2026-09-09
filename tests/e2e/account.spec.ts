import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { completedSprint } from '../helpers/sprint';

const password = 'a';
async function visit(page: Page) {
  const session = page.waitForResponse((r) => r.url().endsWith('/api/v1/session'));
  await page.goto('/');
  const response = await session;
  expect(response.status()).toBe(200);
  return response.json();
}
async function form(page: Page, email: string, register: boolean) {
  await page.locator('#login-open').click();
  if (register) await page.locator('#account-register').click();
  await page.getByLabel('メールアドレス', { exact: true }).fill(email);
  await page.locator('#account-dialog').getByLabel('パスワード', { exact: true }).fill(password);
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-dialog')).not.toBeVisible();
  await expect(page.locator('#account-name')).toHaveText(email);
}

test('guest is automatic; registration preserves best and login restores it in another browser', async ({
  page,
  browser,
}) => {
  const initial = await visit(page);
  await expect(page.locator('#account-name')).toHaveText('ゲスト');
  expect((await page.context().cookies()).find((c) => c.name === 'stack_session')?.httpOnly).toBe(
    true,
  );
  await expect(page.locator('#personal-best')).toBeHidden();
  await page.locator('#sprint').click();
  await expect(page.locator('#best-time')).toHaveText('—');
  const status = await page.evaluate(
    async ({ replay, userId }) => {
      const response = await fetch('/api/v1/records/40line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, replay }),
      });
      return response.status;
    },
    { replay: completedSprint(), userId: initial.user.id },
  );
  expect(status).toBe(200);
  await visit(page);
  await page.locator('#sprint').click();
  await expect(page.locator('#best-time')).toHaveText('00:15.616');
  const email = `${randomUUID()}@example.test`;
  await form(page, email, true);
  await expect(page.locator('#best-time')).toHaveText('00:15.616');
  await visit(page);
  await expect(page.locator('#account-name')).toHaveText(email);
  const second = await browser.newPage();
  try {
    await visit(second);
    await second.locator('#sprint').click();
    await expect(second.locator('#best-time')).toHaveText('—');
    await form(second, email, false);
    await expect(second.locator('#best-time')).toHaveText('00:15.616');
    await second.locator('#login-open').click();
    await second.locator('#account-logout').click();
    await expect(second.locator('#account-dialog')).not.toBeVisible();
    await expect(second.locator('#account-name')).toHaveText('ゲスト');
    await expect(second.locator('#best-time')).toHaveText('—');
  } finally {
    await second.close();
  }
});

test('invalid login stays in the form and Enter does not start a game', async ({ page }) => {
  await visit(page);
  await page.locator('#login-open').click();
  await page.locator('#account-email').fill('missing-browser@example.test');
  await page.locator('#account-password').fill(password);
  await page.locator('#account-password').press('Enter');
  await expect(page.locator('#account-error')).toContainText(
    'メールアドレスまたはパスワードが違います',
  );
  await expect(page.locator('#board-overlay-0')).toContainText('READY');
  await page.locator('#account-close').click();
  await expect(page.locator('#account-password')).toHaveValue('');
});

test('API unavailable still allows guest play and reports login failure', async ({ page }) => {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' }),
  );
  await page.goto('/');
  await page.locator('#login-open').click();
  await page.locator('#account-email').fill('offline@example.test');
  await page.locator('#account-password').fill(password);
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-error')).toContainText('接続できません');
  await page.locator('#account-close').click();
  await page.locator('#start').click();
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
});

test('account form and my-page personal best fit narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  await page.locator('#sprint').click();
  await expect(page.locator('#personal-best')).toBeHidden();
  await page.locator('#mypage-open').click();
  await expect(page.locator('#mypage-best')).toBeVisible();
  await page.locator('#mypage-close').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page.evaluate(() => {
      const header = document.querySelector('.site-header')!.getBoundingClientRect();
      const settings = document.querySelector('#settings-open')!.getBoundingClientRect();
      const toolbar = document.querySelector('.toolbar')!.getBoundingClientRect();
      return settings.bottom <= header.bottom && toolbar.top >= header.bottom;
    }),
  ).toBe(true);
  await page.locator('#login-open').click();
  await page.locator('#account-register').click();
  await expect(page.locator('#account-submit')).toBeVisible();
  expect(
    await page.locator('#account-dialog').evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
});

test('my page shows records and a logged-in email stays visible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const initial = await visit(page);
  await page.locator('#mypage-open').click();
  await expect(page.locator('#mypage-matches')).toHaveText('0');
  await expect(page.locator('#mypage-win-rate')).toHaveText('—');
  await page.locator('#mypage-close').click();
  await page.evaluate(
    async ({ userId, replay }) => {
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`/api/v1/records/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      };
      await post('40line', { userId, replay });
    },
    { userId: initial.user.id, replay: completedSprint() },
  );
  // The layout uses a recorded account fixture; authoritative result persistence
  // is exercised by the matchmaking and D1 integration tests.
  await page.route('**/api/v1/register', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: {
        ...state,
        randomStats: { matches: 2, wins: 1 },
        rating: { current: 1100, peak: 1200, matches: 2 },
      },
    });
  });
  const email = `${randomUUID()}@example.test`;
  await form(page, email, true);
  await expect(page.locator('.site-header #account-name')).toBeVisible();
  await expect(page.locator('.site-header')).not.toContainText('ゲスト');
  await page.locator('#sprint').click();
  await expect(page.locator('#best-owner')).toBeHidden();
  await page.locator('#mypage-open').click();
  await expect(page.locator('#mypage-best')).toHaveText('00:15.616');
  await expect(page.locator('#mypage-matches')).toHaveText('2');
  await expect(page.locator('#mypage-wins')).toHaveText('1');
  await expect(page.locator('#mypage-win-rate')).toHaveText('50.0%');
  await expect(page.locator('#mypage-rating')).toHaveText('1100');
  await expect(page.locator('#mypage-peak-rating')).toHaveText('1200');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#mypage-close').click();
  await page.locator('#login-open').click();
  await page.locator('#account-logout').click();
  await page.locator('#mypage-open').click();
  await expect(page.locator('#mypage-best')).toHaveText('—');
  await expect(page.locator('#mypage-matches')).toHaveText('0');
});
