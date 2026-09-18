import { expect, test } from '@playwright/test';

test('AI対戦は外部接続なしで操作でき、7段階を選べる', async ({ page }) => {
  await page.goto('/');
  const connections: string[] = [];
  page.on('websocket', (socket) => connections.push(socket.url()));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#ai-mode').click();
  await expect(page.locator('#ai-level option')).toHaveCount(7);
  await expect(page.locator('#ai-level-picker button')).toHaveCount(7);
  await page.waitForTimeout(3500);
  await expect(page.locator('#timer')).toHaveText('00:00');
  await expect(page.locator('#pps-1')).toHaveText('0.00');
  await page.locator('[data-ai-level="7"]').click();
  await expect(page.locator('#player-name-1')).toHaveText('AI · レベル7');
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
  await page.keyboard.press('Space');
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  await expect(page.locator('#pps-1')).not.toHaveText('0.00');
  await page.locator('#pause').click();
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
  await page.locator('#pause').click();
  for (let round = 1; round <= 3; round++) {
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    for (let drop = 0; drop < 18; drop++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(50);
      if ((await page.locator('#board-overlay-0').getAttribute('class'))?.includes('round-result'))
        break;
    }
    await expect(page.locator('#board-overlay-0')).toHaveClass(/round-result/);
    await expect(page.locator('#board-overlay-0')).not.toHaveClass(/round-result/);
    await expect(page.locator('#result-dialog')).toBeHidden();
  }
  await expect(page.locator('#player-wins-0')).toBeHidden();
  await expect(page.locator('#wins-required')).toBeHidden();
  await expect(page.locator('#score')).toBeHidden();
  await page.locator('#ai-play').click();
  await expect(page.locator('#result-dialog')).toBeHidden();
  expect(connections).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [320, 390]) {
  test(`スマホ${width}px: AI操作欄が盤面左に収まり、レベル変更と再開ができる`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.locator('#ai-mode').click();
    const picker = await page.locator('#ai-level-picker').boundingBox();
    for (const button of await page.locator('#ai-level-picker button').all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(picker!.y);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(picker!.y + picker!.height);
    }
    await page.locator('[data-ai-level="1"]').click();
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    const board = await page.locator('#board-0').boundingBox();
    const controls = await page.locator('#ai-controls').boundingBox();
    expect(controls!.x).toBeGreaterThanOrEqual(0);
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(board!.x);
    expect(controls!.y).toBeGreaterThan(board!.y);
    expect(controls!.y + controls!.height).toBeLessThan(board!.y + board!.height);
    await page.locator('#ai-level').selectOption('6');
    await expect(page.locator('#player-name-1')).toHaveText('AI · レベル6');
    await page.locator('#ai-play').click();
    await expect(page.locator('#board-overlay-0')).toContainText('3');
    await page.screenshot({ path: `/tmp/tetris-ai-${width}.png`, fullPage: true });
    await page.locator('#practice').click();
    await expect(page.locator('#ai-controls')).toBeHidden();
    await expect(page.locator('#ai-level-picker')).toBeHidden();
  });
}

for (const kind of ['random', 'private'] as const) {
  test(`${kind}: 待機中にエンドレスが自動で始まり対人戦へ切り替わる`, async ({ browser }) => {
    test.setTimeout(60000);
    const a = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const b = await browser.newPage();
    const errors: string[] = [];
    for (const page of [a, b]) page.on('pageerror', (e) => errors.push(e.message));
    try {
      await a.goto('/');
      if (kind === 'random') {
        await a.locator('#match-start').click();
        await a.locator('#match-begin').click();
      } else {
        await a.locator('#online').click();
        await a.locator('#room-create').click();
        await a.locator('#room-create-submit').click();
      }
      await expect(a.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
      await expect(a.locator('#arena')).toHaveClass(/practice-mode/);
      await expect(a.locator('.player-1')).toBeHidden();
      await expect(a.locator('#ai-controls')).toBeHidden();
      await expect(a.locator('.mobile-dock')).toBeVisible();
      await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
      await a.keyboard.press('Space');
      await expect(a.locator('#pps-0')).not.toHaveText('0.00');
      await a.screenshot({ path: `/tmp/tetris-wait-${kind}.png`, fullPage: true });
      if (kind === 'private') {
        for (let i = 0; i < 20 && !(await a.locator('#solo-result').isVisible()); i++) {
          await a.keyboard.press('Space');
          await a.waitForTimeout(60);
        }
        await expect(a.locator('#solo-result')).toBeVisible();
        await a.locator('#solo-restart').click();
        await expect(a.locator('#solo-result')).toBeHidden();
        await expect(a.locator('#arena')).toHaveClass(/practice-mode/);
      }
      if (kind === 'random') {
        await b.goto('/');
        await b.locator('#match-start').click();
        await b.locator('#match-begin').click();
      } else {
        await b.goto(`/?room=${await a.locator('#room-code').textContent()}`);
        await b.locator('#room-join').click();
        await expect(b.locator('#room-ready')).toBeEnabled();
        await expect(b.locator('#arena')).toHaveClass(/practice-mode/);
        await b.keyboard.press('Space');
        await expect(b.locator('#pps-0')).not.toHaveText('0.00');
        await a.locator('#room-ready').click();
        await b.locator('#room-ready').click();
      }
      for (const page of [a, b]) {
        await expect(page.locator('#arena')).not.toHaveClass(/practice-mode/, { timeout: 35000 });
        await expect(page.locator('#ai-controls')).toBeHidden();
        await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
        await expect(page.locator('#player-name-1')).not.toContainText('AI');
      }
      expect(errors).toEqual([]);
    } finally {
      await a.close();
      await b.close();
    }
  });
}
