import { expect, test, type Page } from '@playwright/test';

async function play(page: Page) {
  await page.getByRole('button', { name: 'プレイする' }).click();
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
}
async function preview(page: Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

async function mockPads(
  page: Page,
  index = 0,
  id = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
  mapping = 'standard',
): Promise<void> {
  await page.addInitScript(
    ({ index, id, mapping }) => {
      type State = { connected: boolean; pressed: number[]; axes: number[] };
      const state: State = { connected: true, pressed: [], axes: [0, 0, 0, 0] };
      Object.assign(window, { virtualPad: state });
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () =>
          state.connected
            ? [
                ...Array(index).fill(null),
                {
                  id,
                  index,
                  mapping,
                  connected: true,
                  buttons: Array.from({ length: mapping === 'standard' ? 18 : 8 }, (_, i) => ({
                    pressed: state.pressed.includes(i),
                    touched: false,
                    value: state.pressed.includes(i) ? 1 : 0,
                  })),
                  axes: state.axes,
                  timestamp: performance.now(),
                },
              ]
            : [null],
      });
    },
    { index, id, mapping },
  );
}
async function padButtons(page: Page, pressed: number[]): Promise<void> {
  await page.evaluate(async (pressed) => {
    (window as unknown as { virtualPad: { pressed: number[] } }).virtualPad.pressed = pressed;
    // Wait for actual polls, even when concurrent browsers delay animation frames.
    for (let i = 0; i < 3; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, pressed);
}

test('keyboard practice, HOLD, pause/resume, replay round trip and exit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'STACK ホーム' })).toBeVisible();
  await play(page);
  const initialNext = await preview(page, '#next-0');
  await page.keyboard.press('Space');
  await page.waitForTimeout(180);
  expect(await preview(page, '#next-0')).not.toBe(initialNext);
  const holdBefore = await preview(page, '#hold-0');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(60);
  expect(await preview(page, '#hold-0')).not.toBe(holdBefore);
  await page.keyboard.press('Escape');
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
  const before = await preview(page, '#board-0');
  await page.waitForTimeout(150);
  expect(await preview(page, '#board-0')).toBe(before);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#replay-save').click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.locator('#replay-file').setInputFiles(path!);
  await expect(page.locator('#notice')).toContainText('記録と盤面の一致', { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('only practice and online modes are offered without promotional copy', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#versus')).toHaveCount(0);
  await expect(page.locator('#device-1')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('A LITTLE FOCUS');
  await expect(page.locator('body')).not.toContainText('積んで、');
  await expect(page.locator('body')).not.toContainText('いつもの操作');
  await expect(page.locator('#playbook')).toHaveCount(0);
  await page.locator('#online').click();
  await expect(page.locator('#room-code-input')).toBeHidden();
  await page.locator('#room-join-open').click();
  await expect(page.locator('#room-code-input')).toBeFocused();
  await expect(page.locator('#room-create')).toBeHidden();
  await page.locator('#room-join-back').click();
  await expect(page.locator('#room-create')).toBeVisible();
});

test('DualShock 4 starts with OPTIONS, HOLD does not repeat and triangle locks once', async ({
  page,
}) => {
  await mockPads(page);
  await page.goto('/');
  await expect(page.locator('#device-label-0')).toHaveText('PlayStation');
  await padButtons(page, [9]);
  await padButtons(page, []);
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await padButtons(page, [4]);
  const next = await preview(page, '#next-0');
  await page.waitForTimeout(200);
  expect(await preview(page, '#next-0')).toBe(next);
  await padButtons(page, []);
  await padButtons(page, [3]);
  await page.waitForTimeout(180);
  const afterDrop = await preview(page, '#next-0');
  expect(afterDrop).not.toBe(next);
  await page.waitForTimeout(150);
  expect(await preview(page, '#next-0')).toBe(afterDrop);
  await padButtons(page, []);
  await page.evaluate(() => {
    (window as unknown as { virtualPad: { connected: boolean } }).virtualPad.connected = false;
  });
  await expect(page.locator('#board-overlay-0')).toContainText('切断');
  await page.evaluate(() => {
    (window as unknown as { virtualPad: { connected: boolean } }).virtualPad.connected = true;
  });
  await padButtons(page, [9]);
  await padButtons(page, []);
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
  await page.locator('#settings-open').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  // Closing settings must not also consume Escape as a request to resume.
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
});

test('controller button rebinding persists for the local player', async ({ page }) => {
  await mockPads(page);
  await page.goto('/');
  await page.locator('#settings-open').click();
  await page.locator('[data-action="hold"]').click();
  await padButtons(page, []);
  await padButtons(page, [7]);
  await padButtons(page, []);
  await expect(page.locator('[data-action="hold"]')).toHaveText('B7');
  await page.reload();
  await page.locator('#settings-open').click();
  await expect(page.locator('[data-action="hold"]')).toHaveText('B7');
  await expect(page.locator('#device-1')).toHaveCount(0);
});

test('connected pad can be assigned directly after connecting during play and reconnecting', async ({
  page,
}) => {
  await mockPads(page, 2);
  await page.goto('/');
  await page.evaluate(() => {
    (window as unknown as { virtualPad: { connected: boolean } }).virtualPad.connected = false;
  });
  await expect(page.locator('#connection-status')).toHaveText('KEYBOARD READY');
  await page.locator('#settings-open').click();
  await page.locator('#device-0').selectOption('keyboard1');
  await page.locator('#settings-close').click();
  await play(page);
  await page.locator('#settings-open').click();
  await page.evaluate(() => {
    (window as unknown as { virtualPad: { connected: boolean } }).virtualPad.connected = true;
  });
  await expect(page.locator('#connection-status')).toHaveText('1 GAMEPAD CONNECTED');
  const connected = page.getByLabel('接続中のゲームパッド');
  await expect(connected).toContainText('パッド3: Wireless Controller');
  await expect(page.locator('#device-0 option[value="pad:2"]')).toHaveCount(1);
  await expect(page.locator('#device-0')).toHaveValue('pad:2');
  await expect(page.locator('[data-action="hold"]')).toBeEnabled();
  await padButtons(page, [7]);
  await expect(page.locator('#pad-live')).toContainText('B7');
  await padButtons(page, []);
  await page.locator('#settings-close').click();
  await page.locator('#pause').click();
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  const holdBefore = await preview(page, '#hold-0');
  await padButtons(page, [4]);
  await expect.poll(() => preview(page, '#hold-0')).not.toBe(holdBefore);
  await padButtons(page, []);
});

test('long controller names and assignment buttons fit in mobile settings', async ({ page }) => {
  await mockPads(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#settings-open').click();
  const connected = page.getByLabel('接続中のゲームパッド');
  await expect(connected.getByRole('button', { name: '自分の操作に使う' })).toBeVisible();
  expect(
    await page
      .locator('#settings-dialog')
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  ).toBe(true);
  await expect(page.locator('#device-1')).toHaveCount(0);
});

test('a short hard-drop tap is preserved on high-refresh displays and blur pauses', async ({
  page,
}) => {
  await page.goto('/');
  await play(page);
  const next = await preview(page, '#next-0');
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
  });
  await page.waitForTimeout(200);
  expect(await preview(page, '#next-0')).not.toBe(next);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#board-overlay-0')).toContainText('非アクティブ');
});

test('small screens remain within the viewport and unsupported API still permits keyboard', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'getGamepads', { value: undefined }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#settings-open').click();
  await expect(page.locator('#gamepad-help')).toContainText('利用できません');
  await page.locator('#settings-close').click();
  await play(page);
});

for (const [id, mapping] of [
  ['Xbox Wireless Controller (045e)', 'standard'],
  ['DualSense (054c:0ce6)', 'standard'],
  ['Nintendo Switch Pro Controller (057e)', 'standard'],
  ['Generic USB Gamepad', ''],
]) {
  test(`${id} is automatically assigned with working default buttons`, async ({ page }) => {
    await mockPads(page, 1, id, mapping);
    await page.goto('/');
    await expect(page.locator('#device-0')).toHaveValue('pad:1');
    await play(page);
    const before = await preview(page, '#hold-0');
    await padButtons(page, [4]);
    await expect.poll(() => preview(page, '#hold-0')).not.toBe(before);
    await padButtons(page, []);
    await padButtons(page, [3]);
    await expect(page.locator('#pps-0')).not.toHaveText('0.00');
    await padButtons(page, []);
  });
}

test('previously unmapped pads receive defaults while customized buttons are kept', async ({
  page,
}) => {
  await mockPads(page, 0, 'Generic USB Gamepad', '');
  await page.addInitScript(() =>
    localStorage.setItem(
      'stack-gamepads-v1',
      JSON.stringify({
        'Generic USB Gamepad:': {
          left: [],
          right: [],
          soft: [],
          hard: [],
          ccw: [],
          cw: [],
          hold: [{ kind: 'button', index: 6 }],
          pause: [],
        },
      }),
    ),
  );
  await page.goto('/');
  await expect(page.locator('#device-0')).toHaveValue('pad:0');
  await play(page);
  const before = await preview(page, '#hold-0');
  await padButtons(page, [6]);
  await expect.poll(() => preview(page, '#hold-0')).not.toBe(before);
});
