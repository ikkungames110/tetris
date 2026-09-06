import { expect, test, type Page } from '@playwright/test';

async function create(page: Page) {
  await page.goto('/');
  await page.locator('#online').click();
  await page.locator('#room-create').click();
  await expect(page.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  return (await page.locator('#room-code').textContent())!;
}
async function join(page: Page, code: string) {
  await page.goto(`/?room=${code}`);
  await expect(page.locator('#room-code-input')).toHaveValue(code);
  await page.locator('#room-join').click();
  await expect(page.locator('#room-code')).toHaveText(code);
}
async function start(a: Page, b: Page) {
  await a.locator('#room-ready').click();
  await expect(a.locator('#room-ready')).toBeDisabled();
  await b.locator('#room-ready').click();
  await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
  await expect(b.locator('#board-overlay-1')).toBeHidden();
}

test('two browsers join, play on their own seats, resume after reload and handle a forfeit', async ({
  browser,
}) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  const errors: string[] = [];
  for (const page of [a, b]) page.on('pageerror', (error) => errors.push(error.message));
  for (const page of [a, b])
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname === '/online')
        errors.push('Unexpected game server connection');
    });
  await b.addInitScript(() => {
    const NativeConnection = window.RTCPeerConnection;
    const sockets: RTCPeerConnection[] = [];
    Object.assign(window, { onlineTestConnections: sockets });
    window.RTCPeerConnection = class extends NativeConnection {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        sockets.push(this);
      }
    };
  });
  try {
    const code = await create(a);
    await join(b, code);
    await expect(b.locator('#room-seat')).toContainText('PLAYER 02');
    await start(a, b);
    await b.keyboard.press('Space');
    await expect(a.locator('#pps-1')).not.toHaveText('0.00');
    await expect(a.locator('#pps-0')).toHaveText('0.00');
    await a.keyboard.press('Space');
    await expect(b.locator('#pps-0')).not.toHaveText('0.00');
    await b.keyboard.press('KeyC');
    await expect
      .poll(async () => {
        const images = await Promise.all(
          [a, b].map((page) =>
            page.locator('#hold-1').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
          ),
        );
        return images[0] === images[1];
      })
      .toBe(true);
    await b.keyboard.press('Escape');
    await expect(b.locator('#board-overlay-1')).toBeHidden();
    await b.evaluate(() => {
      (
        window as unknown as { onlineTestConnections: RTCPeerConnection[] }
      ).onlineTestConnections[0].close();
    });
    await expect
      .poll(() =>
        b.evaluate(
          () =>
            (window as unknown as { onlineTestConnections: RTCPeerConnection[] })
              .onlineTestConnections.length,
        ),
      )
      .toBe(2);
    await expect(b.locator('#online-status')).toContainText('対戦中');
    await expect(b.locator('#room-seat')).toContainText('PLAYER 02');
    await b.reload();
    await expect(b.locator('#room-code')).toHaveText(code);
    await expect(b.locator('#room-seat')).toContainText('PLAYER 02');
    await expect(b.locator('#pps-1')).not.toHaveText('0.00');
    await expect(b.locator('#board-overlay-1')).toBeHidden();
    await b.locator('#leave').click();
    await expect(a.locator('#result-title')).toHaveText('PLAYER 1 WIN');
    await expect(a.locator('#result-description')).toContainText('退室');
    await a.locator('#result-next').click();
    await expect(a.locator('#room-create')).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});

test('the host can leave and the guest receives the final result over P2P', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  try {
    await join(b, await create(a));
    await start(a, b);
    await a.locator('#leave').click();
    await expect(b.locator('#result-title')).toHaveText('PLAYER 2 WIN');
    await expect(b.locator('#result-description')).toContainText('退室');
  } finally {
    await a.close();
    await b.close();
  }
});

test('an abruptly closed host ends the match after reconnect attempts expire', async ({
  browser,
}) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  try {
    await join(b, await create(a));
    await start(a, b);
    await a.close();
    await expect(b.locator('#result-title')).toHaveText('対戦を終了しました', { timeout: 18_000 });
    await expect(b.locator('#result-description')).toContainText(
      'ホストとの接続を復旧できませんでした',
    );
    await b.locator('#result-next').click();
    await expect(b.locator('#room-create')).toBeEnabled();
  } finally {
    await a.close();
    await b.close();
  }
});

test('online layout keeps usable boards on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  const board = await page.locator('#board-0').boundingBox();
  expect(board!.width).toBeGreaterThan(70);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#leave').click();
});

test('both browsers must accept the next round and a rematch', async ({ browser }) => {
  test.setTimeout(45_000);
  const a = await browser.newPage();
  const b = await browser.newPage();
  try {
    await join(b, await create(a));
    await start(a, b);
    for (let round = 1; round <= 2; round++) {
      for (let i = 0; i < 30 && !(await a.locator('#result-dialog').isVisible()); i++) {
        await a.keyboard.press('Space');
        await a.waitForTimeout(70);
      }
      await expect(a.locator('#result-title')).toHaveText('PLAYER 2 WIN');
      await expect(b.locator('#result-title')).toHaveText('PLAYER 2 WIN');
      await expect(a.locator('#score')).toHaveText(`0 : ${round}`);
      await a.locator('#result-next').click();
      await expect(a.locator('#result-next')).toBeDisabled();
      await expect(b.locator('#result-dialog')).toBeVisible();
      await b.locator('#result-next').click();
      await expect(a.locator('#result-dialog')).not.toBeVisible();
      await expect(a.locator('#board-overlay-0')).toBeVisible();
      await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    }
    await expect(a.locator('#score')).toHaveText('0 : 0');
    await expect(b.locator('#score')).toHaveText('0 : 0');
  } finally {
    await a.close();
    await b.close();
  }
});

test('invalid and full room errors allow retry', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  const c = await browser.newPage();
  try {
    await c.goto('/?room=AAAAAA');
    await c.locator('#room-join').click();
    await expect(c.locator('#notice')).toContainText('見つかりません');
    const code = await create(a);
    await join(b, code);
    await c.locator('#room-code-input').fill(code);
    await c.locator('#room-join').click();
    await expect(c.locator('#notice')).toContainText('満員');
    await c.locator('#room-create').click();
    await expect(c.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
});
