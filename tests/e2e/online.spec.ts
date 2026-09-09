import { expect, test, type Page } from '@playwright/test';

async function create(page: Page) {
  await page.goto('/');
  await page.locator('#online').click();
  await page.locator('#room-create').click();
  await page.locator('#room-create-submit').click();
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
    await a.goto('/');
    await a.getByRole('button', { name: 'ルーム対戦', exact: true }).click();
    await expect(a.locator('#room-create')).toBeVisible();
    await expect(a.locator('#room-join-open')).toBeVisible();
    await a.locator('#room-create').click();
    await a.locator('#handicap-seat').selectOption('1');
    await a.locator('#handicap-lines').selectOption('3');
    await a.locator('#room-create-submit').click();
    await expect(a.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = (await a.locator('#room-code').textContent())!;
    await join(b, code);
    for (const page of [a, b])
      await expect(page.locator('#room-handicap')).toContainText('2P · 各消去の送信 −3ライン');
    await expect(b.locator('#room-seat')).toContainText('2P');
    await start(a, b);
    await b.keyboard.press('Space');
    await expect(a.locator('#pps-1')).not.toHaveText('0.00');
    await expect(a.locator('#pps-0')).toHaveText('0.00');
    await a.keyboard.press('Space');
    await expect(b.locator('#pps-0')).not.toHaveText('0.00');
    await b.keyboard.press('ShiftLeft');
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
    await expect(b.locator('#room-seat')).toContainText('2P');
    await b.reload();
    await expect(b.locator('#room-handicap')).toContainText('2P · 各消去の送信 −3ライン');
    await expect(b.locator('#room-code')).toHaveText(code);
    await expect(b.locator('#room-seat')).toContainText('2P');
    await expect(b.locator('#pps-1')).not.toHaveText('0.00');
    await expect(b.locator('#board-overlay-1')).toBeHidden();
    await b.locator('#leave').click();
    await expect(a.locator('#result-title')).toHaveText('WIN');
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
    await expect(b.locator('#result-title')).toHaveText('WIN');
    await expect(b.locator('#result-description')).toContainText('退室');
  } finally {
    await a.close();
    await b.close();
  }
});

test('an abruptly closed host ends the match after reconnect attempts expire', async ({
  browser,
}) => {
  test.setTimeout(75_000);
  const a = await browser.newPage();
  const b = await browser.newPage();
  try {
    await join(b, await create(a));
    await start(a, b);
    await a.close();
    await expect(b.locator('#result-title')).toHaveText('対戦を終了しました', { timeout: 65_000 });
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

test('rounds show WIN and LOSE on the board, then the same room waits for both players to rematch', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const a = await browser.newPage();
  const b = await browser.newPage();
  try {
    const code = await create(a);
    await join(b, code);
    for (const [page, seat] of [
      [a, 0],
      [b, 1],
    ] as const) {
      const own = await page.locator(`#board-${seat}`).boundingBox();
      const other = await page.locator(`#board-${1 - seat}`).boundingBox();
      expect(own!.x).toBeLessThan(other!.x);
      await expect(page.locator(`#player-role-${seat}`)).toHaveText('自分');
      await expect(page.locator(`#player-name-${seat}`)).toHaveText('ゲスト');
      await expect(page.locator('#wins-required')).toHaveText('FIRST TO 3');
    }
    await start(a, b);
    for (let round = 1; round <= 3; round++) {
      for (let i = 0; i < 30 && !(await a.locator('#board-overlay-0').isVisible()); i++) {
        await a.keyboard.press('Space');
        await a.waitForTimeout(70);
      }
      await expect(a.locator('#board-overlay-0 > span')).toHaveText('LOSE');
      await expect(b.locator('#board-overlay-1 > span')).toHaveText('WIN');
      await expect(a.locator('#score')).toHaveText(`0 : ${round}`);
      await expect(b.locator('#score')).toHaveText(`${round} : 0`);
      for (const page of [a, b])
        await expect(page.locator('#player-wins-1')).toHaveText(
          '★'.repeat(round) + '☆'.repeat(3 - round),
        );
      await expect(a.locator('#result-dialog')).toBeHidden();
      if (round < 3) {
        await a.waitForTimeout(1000);
        await expect(a.locator('#result-dialog')).toBeHidden();
        await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
      }
    }
    await expect(a.locator('#result-title')).toHaveText('LOSE');
    await expect(b.locator('#result-title')).toHaveText('WIN');
    await expect(a.locator('#result-dialog')).toBeVisible();
    await expect(b.locator('#result-dialog')).toBeVisible();
    await a.locator('#result-home').click();
    await b.keyboard.press('Escape');
    for (const page of [a, b]) {
      await expect(page.locator('#room-code')).toHaveText(code);
      await expect(page.locator('#room-ready')).toBeEnabled();
    }
    await a.locator('#room-ready').click();
    await a.waitForTimeout(3500);
    await expect(a.locator('#room-ready')).toBeDisabled();
    await expect(a.locator('#score')).toHaveText('0 : 3');
    await b.locator('#room-ready').click();
    await expect(a.locator('#score')).toHaveText('0 : 0');
    await expect(b.locator('#score')).toHaveText('0 : 0');
    await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    await expect(b.locator('#room-code')).toHaveText(code);
    await b.screenshot({ path: 'test-results/versus-self-left.png' });
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
    // The local PeerServer expires offers to missing peers after 5 seconds.
    await expect(c.locator('#notice')).toContainText('見つかりません', { timeout: 10000 });
    const code = await create(a);
    await join(b, code);
    await c.locator('#room-join-open').click();
    await c.locator('#room-code-input').fill(code);
    await c.locator('#room-join').click();
    await expect(c.locator('#notice')).toContainText('満員');
    await c.locator('#room-create').click();
    await c.locator('#room-create-submit').click();
    await expect(c.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
});

test('guest input renders before a delayed round trip and converges without duplicate drops', async ({
  browser,
}) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  for (const page of [a, b]) {
    await page.addInitScript(() => {
      type Payload = string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>;
      const original = RTCDataChannel.prototype.send as (data: Payload) => void;
      RTCDataChannel.prototype.send = function (data: Payload) {
        const channel = this;
        const delay = (window as unknown as { testNetworkDelay?: number }).testNetworkDelay ?? 0;
        if (!delay) return original.call(channel, data);
        setTimeout(() => {
          if (channel.readyState === 'open') original.call(channel, data);
        }, delay);
      };
    });
  }
  try {
    await join(b, await create(a));
    await start(a, b);
    for (const page of [a, b])
      await page.evaluate(() => Object.assign(window, { testNetworkDelay: 150 }));
    await b.waitForTimeout(500);
    for (const page of [a, b]) {
      await page.evaluate(() => {
        const counter = document.querySelector('#pps-1')!;
        const observer = new MutationObserver(() => {
          if (counter.textContent !== '0.00') {
            Object.assign(window, { firstDropAt: Date.now() });
            observer.disconnect();
          }
        });
        observer.observe(counter, { childList: true, characterData: true, subtree: true });
      });
    }
    const sentAt = await b.evaluate(() => {
      const time = Date.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
      return time;
    });
    await expect(a.locator('#pps-1')).not.toHaveText('0.00');
    const guestAt = await b.evaluate(
      () => (window as unknown as { firstDropAt: number }).firstDropAt,
    );
    const hostAt = await a.evaluate(
      () => (window as unknown as { firstDropAt: number }).firstDropAt,
    );
    expect(guestAt - sentAt).toBeLessThan(100);
    expect(hostAt - sentAt).toBeGreaterThanOrEqual(140);
    console.log(
      `Injected RTT 300ms: guest display ${guestAt - sentAt}ms, host confirmation ${hostAt - sentAt}ms`,
    );
    // The settled bottom row must agree after the correction arrives. A repeated
    // hard drop would add pieces and change the visible board / result stats.
    await b.waitForTimeout(700);
    const bottom = (page: Page) =>
      page
        .locator('#board-1')
        .evaluate((canvas: HTMLCanvasElement) =>
          Array.from(canvas.getContext('2d')!.getImageData(0, 540, 300, 60).data),
        );
    expect(await bottom(b)).toEqual(await bottom(a));
    // End the artificial pre-send delay and flush its timers before testing leave.
    for (const page of [a, b])
      await page.evaluate(() => Object.assign(window, { testNetworkDelay: 0 }));
    await b.waitForTimeout(200);
    await b.locator('#leave').click();
    await expect(a.locator('#result-stats')).toContainText('ゲスト（相手）  1ミノ');
  } finally {
    await a.close();
    await b.close();
  }
});

test('a gamepad connected by the guest automatically controls their own online board', async ({
  browser,
}) => {
  const a = await browser.newPage(),
    b = await browser.newPage();
  try {
    await join(b, await create(a));
    await start(a, b);
    await b.evaluate(() => {
      const state = { pressed: [] as number[] };
      Object.assign(window, { guestPad: state });
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => [
          null,
          null,
          {
            id: 'Xbox Wireless Controller',
            index: 2,
            mapping: 'standard',
            connected: true,
            buttons: Array.from({ length: 17 }, (_, i) => ({
              pressed: state.pressed.includes(i),
              value: state.pressed.includes(i) ? 1 : 0,
            })),
            axes: [0, 0, 0, 0],
          },
        ],
      });
    });
    await expect(b.locator('#device-0')).toHaveValue('pad:2');
    await b.evaluate(() => {
      (window as unknown as { guestPad: { pressed: number[] } }).guestPad.pressed = [3];
    });
    await expect(a.locator('#pps-1')).not.toHaveText('0.00');
    await expect(a.locator('#pps-0')).toHaveText('0.00');
  } finally {
    await a.close();
    await b.close();
  }
});

test('room creation offers optional handicaps and join has no handicap controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'ルーム対戦', exact: true }).click();
  await page.locator('#room-create').click();
  await expect(page.locator('#handicap-seat')).toHaveValue('none');
  await expect(page.locator('#room-wins')).toHaveValue('3');
  await expect(page.locator('#handicap-lines')).toBeDisabled();
  await page.locator('#handicap-seat').selectOption('0');
  await page.locator('#handicap-lines').selectOption('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#room-create-back').click();
  await page.locator('#room-join-open').click();
  await expect(page.locator('#room-code-input')).toBeVisible();
  await expect(page.locator('#handicap-seat')).toBeHidden();
  await page.locator('#room-join-back').click();
  await page.locator('#room-create').click();
  await page.locator('#room-create-submit').click();
  await expect(page.locator('#room-handicap')).toContainText('1P · 各消去の送信 −2ライン');
  await page.locator('#leave').click();
  await page.locator('#room-create').click();
  await expect(page.locator('#handicap-seat')).toHaveValue('none');
});
