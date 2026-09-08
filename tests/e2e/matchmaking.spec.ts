import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
async function waitForOpponent(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'ランダム対戦', exact: true }).click();
  await expect(page.locator('#match-wait')).toBeVisible();
  await expect(page.locator('#room-entry')).toBeHidden();
  await expect(page.locator('#room-handicap')).toBeHidden();
}
async function playing(page: Page) {
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 35_000 });
  await expect(page.locator('#match-wait')).toBeHidden();
}

test('waiting browsers match and start without entering a code or clicking ready', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const a = await browser.newPage(),
    b = await browser.newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
  try {
    await a.goto('/');
    await a.locator('#online').click();
    await a.locator('#room-create').click();
    await a.locator('#handicap-seat').selectOption('0');
    await a.locator('#handicap-lines').selectOption('3');
    await a.locator('#match-start').click();
    await a.waitForTimeout(700);
    await expect(a.locator('#match-status')).toContainText('待っています');
    await waitForOpponent(b);
    await Promise.all([playing(a), playing(b)]);
    for (const page of [a, b]) {
      await expect(page.locator('#room-handicap')).toBeHidden();
      await expect(page.locator('#match-start')).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(a.locator('#room-code')).toHaveText(
      (await b.locator('#room-code').textContent())!,
    );
    const seat = (await b.locator('#room-seat').textContent())!.includes('2P') ? 1 : 0;
    await b.keyboard.press('Space');
    await expect(a.locator(`#pps-${seat}`)).not.toHaveText('0.00');
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});

test('four simultaneous waiters form two separate pairs', async ({ browser }) => {
  test.setTimeout(80_000);
  const pages = await Promise.all(Array.from({ length: 4 }, () => browser.newPage()));
  try {
    await Promise.all(pages.map(waitForOpponent));
    await Promise.all(pages.map(playing));
    const codes = await Promise.all(pages.map((p) => p.locator('#room-code').textContent()));
    expect(new Set(codes).size).toBe(2);
    for (const code of new Set(codes)) expect(codes.filter((c) => c === code)).toHaveLength(2);
  } finally {
    await Promise.all(pages.map((p) => p.close()));
  }
});

test('cancelling and closing a waiting browser releases the queue', async ({ browser }) => {
  test.setTimeout(70_000);
  const a = await browser.newPage(),
    b = await browser.newPage(),
    c = await browser.newPage();
  try {
    await waitForOpponent(a);
    await expect(a.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    await a.locator('#match-cancel').click();
    await expect(a.locator('#match-start')).toBeEnabled();
    await expect(a.locator('#match-wait')).toBeHidden();
    await waitForOpponent(b);
    await expect(b.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    await b.close();
    await waitForOpponent(c);
    await a.locator('#match-start').click();
    await Promise.all([playing(a), playing(c)]);
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
});

test('completed random matches save one result per player and failed saves can be retried', async ({
  browser,
}) => {
  test.setTimeout(70_000);
  const a = await browser.newPage(),
    b = await browser.newPage();
  let failSave = true;
  await a.route('**/api/v1/records/random', (route) =>
    failSave
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: '戦績を保存できませんでした。' }),
        })
      : route.continue(),
  );
  try {
    await waitForOpponent(a);
    await expect(a.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    await waitForOpponent(b);
    await Promise.all([playing(a), playing(b)]);
    for (let round = 1; round <= 2; round++) {
      for (let i = 0; i < 35 && !(await a.locator('#result-dialog').isVisible()); i++) {
        await a.keyboard.press('Space');
        await a.waitForTimeout(90);
      }
      await expect(a.locator('#result-title')).toHaveText('PLAYER 2 WIN');
      await expect(a.locator('#score')).toHaveText(`0 : ${round}`);
      if (round === 1) {
        await expect(a.locator('#result-dialog')).toBeHidden({ timeout: 6000 });
        await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
      }
    }
    await expect(b.locator('#mypage-matches')).toHaveText('1');
    await expect(b.locator('#mypage-wins')).toHaveText('1');
    await a.locator('#result-home').click();
    await a.locator('#mypage-open').click();
    await expect(a.locator('#mypage-record-retry')).toBeVisible();
    failSave = false;
    await a.locator('#mypage-record-retry').click();
    await expect(a.locator('#mypage-matches')).toHaveText('1');
    await expect(a.locator('#mypage-wins')).toHaveText('0');
    await expect(a.locator('#mypage-win-rate')).toHaveText('0.0%');
    await expect(a.locator('#mypage-record-retry')).toBeHidden();
    await a.reload();
    await a.locator('#mypage-open').click();
    await expect(a.locator('#mypage-matches')).toHaveText('1');
    await b.reload();
    await b.locator('#mypage-open').click();
    await expect(b.locator('#mypage-matches')).toHaveText('1');
    await expect(b.locator('#mypage-win-rate')).toHaveText('100.0%');
  } finally {
    await a.close();
    await b.close();
  }
});
