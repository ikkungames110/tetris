import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.describe.configure({ mode: 'serial' });
test('ランダム対戦タブは自分のレートを表示し、開始ボタンを押すまで接続しない', async ({ page }) => {
  const connections: string[] = [];
  page.on('websocket', (socket) => {
    if (!socket.url().includes('vite')) connections.push(socket.url());
  });
  await page.goto('/');
  await page.locator('#match-start').click();
  await expect(page.locator('#match-begin')).toBeVisible();
  await expect(page.locator('#random-current-rating')).toHaveText('—');
  await expect(page.locator('#random-rating-status')).toContainText('ゲストでも対戦');
  await expect(page.locator('#match-wait')).toBeHidden();
  for (const seat of [0, 1]) {
    await expect(page.locator(`#board-overlay-${seat}`)).toBeHidden();
    await expect(page.locator(`.player-${seat} > .player-identity`)).toBeHidden();
    await expect(page.locator(`.player-${seat} > .player-stats`)).toBeHidden();
  }
  await page.waitForTimeout(350);
  // Vite's development socket is the only connection before matchmaking.
  expect(
    connections.filter((url) => url.includes('/api/v1/random/') || url.includes('peerjs')),
  ).toEqual([]);
  await page.locator('#login-open').click();
  await page.locator('#account-register').click();
  await page.locator('#account-email').fill(`${randomUUID()}@example.test`);
  await page.locator('#account-password').fill('a');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-dialog')).toBeHidden();
  await expect(page.locator('#random-current-rating')).toHaveText('1000');
  await expect(page.locator('#random-peak-rating')).toHaveText('1000');
  await page.locator('#match-begin').click();
  await expect(page.locator('#board-overlay-0')).toHaveText('waiting for match...');
  await expect(page.locator('#board-overlay-0 > span')).toHaveCSS('font-family', /Rajdhani/);
  await expect(page.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  await page.locator('#match-cancel').click();
  await expect(page.locator('#match-begin')).toBeVisible();
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await expect(page.locator('#random-current-rating')).toHaveText('1000');
});

async function waitForOpponent(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'ランダム対戦', exact: true }).click();
  await page.locator('#match-begin').click();
  await expect(page.locator('#match-wait')).toBeVisible();
  await expect(page.locator('#room-entry')).toBeHidden();
  await expect(page.locator('#room-handicap')).toBeHidden();
}
async function expectWaiting(page: Page) {
  for (const seat of [0, 1]) {
    await expect(page.locator(`#board-overlay-${seat}`)).toHaveText('waiting for match...');
    await expect(page.locator(`#player-name-${seat}`)).toBeHidden();
    await expect(page.locator(`#rating-${seat}`)).toBeHidden();
  }
}
async function playing(page: Page) {
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 35_000 });
  await expect(page.locator('#match-wait')).toBeHidden();
}

async function register(page: Page) {
  await page.goto('/');
  await page.locator('#login-open').click();
  await page.locator('#account-register').click();
  await page.locator('#account-email').fill(`${randomUUID()}@example.test`);
  await page.locator('#account-password').fill('a');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-dialog')).toBeHidden();
  await expect(page.locator('#mypage-rating')).toHaveText('1000');
  await expect(page.locator('#mypage-peak-rating')).toHaveText('1000');
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
    await a.locator('#match-begin').click();
    await a.waitForTimeout(700);
    await expect(a.locator('#match-status')).toBeHidden();
    await expectWaiting(a);
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
    await a.locator('#match-begin').click();
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
    for (let round = 1; round <= 3; round++) {
      for (let i = 0; i < 35 && !(await a.locator('#board-overlay-0').isVisible()); i++) {
        await a.keyboard.press('Space');
        await a.waitForTimeout(90);
      }
      await expect(a.locator('#board-overlay-0 > span')).toHaveText('LOSE');
      await expect(a.locator('#score')).toHaveText(`0 : ${round}`);
      if (round < 3) {
        await expect(a.locator('#result-dialog')).toBeHidden();
        await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 8000 });
      }
    }
    await expect(a.locator('#result-dialog')).toBeVisible();
    await expect(b.locator('#result-title')).toHaveText('WIN');
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

for (const lostSeat of [0, 1])
  test(`closing random seat ${lostSeat} records a loss for that account and a win for its opponent`, async ({
    browser,
  }) => {
    test.setTimeout(45000);
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    try {
      await Promise.all(pages.map(register));
      await waitForOpponent(pages[0]);
      await expect(pages[0].locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
      await waitForOpponent(pages[1]);
      await Promise.all(pages.map(playing));
      for (const page of pages) {
        await expect(page.locator('#rating-0')).toHaveText('RATE 1000');
        await expect(page.locator('#rating-1')).toHaveText('RATE 1000');
      }
      if (lostSeat === 0) {
        await pages[1].setViewportSize({ width: 390, height: 844 });
        await expect(pages[1].locator('#rating-0')).toBeVisible();
        await expect(pages[1].locator('#rating-1')).toBeVisible();
        expect(await pages[1].evaluate(() => document.documentElement.scrollWidth)).toBe(390);
        await pages[1].screenshot({ path: 'test-results/random-rating-mobile.png' });
      }
      await pages[lostSeat].close();
      const survivor = pages[1 - lostSeat];
      await expect(survivor.locator('#result-title')).toHaveText('WIN');
      await expect(survivor.locator('#result-rating')).toContainText('1024 (+24)');
      await expect(survivor.locator('#mypage-rating')).toHaveText('1024');
      await expect(survivor.locator('#mypage-peak-rating')).toHaveText('1024');
      const returned = await contexts[lostSeat].newPage();
      await returned.goto('/');
      await returned.locator('#mypage-open').click();
      await expect(returned.locator('#mypage-rating')).toHaveText('976');
      await expect(returned.locator('#mypage-peak-rating')).toHaveText('1000');
      await expect(returned.locator('#mypage-matches')).toHaveText('1');
      await expect(returned.locator('#mypage-wins')).toHaveText('0');
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

test('a guest opponent keeps both ratings unchanged, including a forfeit', async ({ browser }) => {
  test.setTimeout(45000);
  const a = await browser.newPage(),
    b = await browser.newPage();
  try {
    await register(a);
    await waitForOpponent(a);
    await expect(a.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    await waitForOpponent(b);
    await Promise.all([playing(a), playing(b)]);
    await expect(a.locator('#rating-0')).toHaveText('RATE 1000');
    await expect(a.locator('#rating-1')).toHaveText('GUEST');
    await b.locator('#leave').click();
    await expect(a.locator('#result-rating')).toHaveText(
      'ゲスト参加のため、お互いのレート増減なし',
    );
    await expect(a.locator('#mypage-matches')).toHaveText('1');
    await expect(a.locator('#mypage-rating')).toHaveText('1000');
    await expect(a.locator('#mypage-peak-rating')).toHaveText('1000');
    await expect(b.locator('#mypage-matches')).toHaveText('1');
    await expect(b.locator('#mypage-rating')).toHaveText('—');
  } finally {
    await a.close();
    await b.close();
  }
});

test('待機中に接続が繰り返し切れても検索を続け、後から来た相手と対戦できる', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const a = await browser.newPage();
  const b = await browser.newPage();
  await a.addInitScript(() => {
    const sockets: WebSocket[] = [];
    Object.assign(window, { waitingSockets: sockets });
    const NativeSocket = WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes('/api/v1/random/')) sockets.push(this);
      }
    };
  });
  try {
    await waitForOpponent(a);
    await expect(a.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    for (let i = 0; i < 6; i++) {
      const code = await a.locator('#room-code').textContent();
      await a.evaluate(() => {
        (window as unknown as { waitingSockets: WebSocket[] }).waitingSockets.at(-1)!.close();
      });
      await expect(a.locator('#room-code')).not.toHaveText(code!);
      await expect(a.locator('#match-wait')).toBeVisible();
      await expect(a.locator('#result-dialog')).toBeHidden();
      await expect(a.locator('#board-overlay-0')).toHaveText('waiting for match...');
      await expectWaiting(a);
    }
    await a.setViewportSize({ width: 390, height: 844 });
    await expectWaiting(a);
    const title = a.locator('#board-overlay-0 > span');
    const box = (await title.boundingBox())!;
    const lineHeight = await title.evaluate((element) =>
      parseFloat(getComputedStyle(element).lineHeight),
    );
    expect(box.height).toBeLessThanOrEqual(lineHeight + 1);
    await a.screenshot({ path: 'test-results/matching-wait-mobile.png' });
    await waitForOpponent(b);
    await Promise.all([playing(a), playing(b)]);
  } finally {
    await a.close();
    await b.close();
  }
});
