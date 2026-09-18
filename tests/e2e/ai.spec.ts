import { expect, test } from '@playwright/test';

test('AI対戦は外部接続なしで操作でき、5段階を選べる', async ({ page }) => {
  await page.goto('/');
  const connections: string[] = [];
  page.on('websocket', (socket) => connections.push(socket.url()));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#ai-mode').click();
  await expect(page.locator('#ai-level option')).toHaveCount(5);
  await page.locator('#ai-level').selectOption('5');
  await expect(page.locator('#player-name-1')).toHaveText('AI · レベル5');
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
  await page.keyboard.press('Space');
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  await expect(page.locator('#pps-1')).not.toHaveText('0.00');
  await page.locator('#pause').click();
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
  await page.locator('#pause').click();
  for (let round = 1; round <= 2; round++) {
    await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
    for (let drop = 0; drop < 18; drop++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(50);
      if ((await page.locator('#board-overlay-0').getAttribute('class'))?.includes('round-result'))
        break;
    }
    if (round === 1) await expect(page.locator('#round-label')).toHaveText('ROUND 02');
  }
  await expect(page.locator('#result-dialog')).toBeVisible();
  await expect(page.locator('#result-description')).toContainText('2本先取');
  await page.locator('#result-next').click();
  await expect(page.locator('#result-dialog')).toBeHidden();
  expect(connections).toEqual([]);
  expect(errors).toEqual([]);
});

for (const kind of ['random', 'private'] as const) {
  test(`${kind}: 待機中のAI戦から対人戦へ切り替わる`, async ({ browser }) => {
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
      await a.locator('#ai-play').click();
      await expect(a.locator('#player-name-1')).toHaveText('AI · レベル3');
      await expect(a.locator('.mobile-dock')).toBeVisible();
      await expect(a.locator('#board-overlay-0')).toBeHidden({ timeout: 7000 });
      await expect(a.locator('#pps-1')).not.toHaveText('0.00');
      await a.screenshot({ path: `/tmp/tetris-ai-${kind}.png`, fullPage: true });
      if (kind === 'random') {
        await b.goto('/');
        await b.locator('#match-start').click();
        await b.locator('#match-begin').click();
      } else {
        await b.goto(`/?room=${await a.locator('#room-code').textContent()}`);
        await b.locator('#room-join').click();
        await expect(b.locator('#room-ready')).toBeEnabled();
        await b.locator('#ai-play').click();
        await expect(b.locator('#player-name-1')).toContainText('AI');
        await a.locator('#room-ready').click();
        await b.locator('#room-ready').click();
      }
      for (const page of [a, b]) {
        await expect(page.locator('#ai-controls')).toBeHidden({ timeout: 35000 });
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
