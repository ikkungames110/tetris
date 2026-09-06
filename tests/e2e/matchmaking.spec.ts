import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
async function waitForOpponent(page: Page) {
  await page.goto('/');
  await page.locator('#online').click();
  await page.locator('#match-start').click();
  await expect(page.locator('#match-wait')).toBeVisible();
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
    await waitForOpponent(a);
    await a.waitForTimeout(700);
    await expect(a.locator('#match-status')).toContainText('待っています');
    await waitForOpponent(b);
    await Promise.all([playing(a), playing(b)]);
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
    await expect(a.locator('#room-create')).toBeEnabled();
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
