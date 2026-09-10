import { startSolo } from '../helpers/solo';
import { expect, test, type Page } from '@playwright/test';

async function openKeyboardSettings(page: Page) {
  await page.locator('#settings-open').click();
  await page.locator('#controller-tab').click();
  await expect(page.locator('#device-0')).toHaveValue('keyboard1');
}

const binding = (page: Page, action: string) =>
  page.locator(`#mapping-grid [data-action="${action}"]`);
const holdImage = (page: Page) =>
  page.locator('#hold-0').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

test('HOLDの初期キーは左Shiftだけで、変更・保存・復元できる', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#hold-hint-0')).toHaveText('左Shift');
  await startSolo(page);
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  const before = await holdImage(page);
  await page.keyboard.press('KeyC');
  await page.keyboard.press('ShiftRight');
  await page.waitForTimeout(100);
  expect(await holdImage(page)).toBe(before);
  await page.keyboard.press('ShiftLeft');
  await expect.poll(() => holdImage(page)).not.toBe(before);

  await openKeyboardSettings(page);
  await expect(binding(page, 'hold')).toHaveText('左Shift');
  await binding(page, 'hold').click();
  await page.keyboard.press('KeyC');
  await expect(binding(page, 'hold')).toHaveText('C');
  await expect(page.locator('#hold-hint-0')).toHaveText('C');
  await expect(page.locator('#quick-controls')).toContainText('C HOLD');
  await page.reload();
  await expect(page.locator('#hold-hint-0')).toHaveText('C');
  await startSolo(page);
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  const empty = await holdImage(page);
  await page.keyboard.press('ShiftLeft');
  await page.waitForTimeout(100);
  expect(await holdImage(page)).toBe(empty);
  await page.keyboard.press('KeyC');
  await expect.poll(() => holdImage(page)).not.toBe(empty);
  await openKeyboardSettings(page);
  await page.locator('#mapping-reset').click();
  await expect(binding(page, 'hold')).toHaveText('左Shift');
  await page.reload();
  await expect(page.locator('#hold-hint-0')).toHaveText('左Shift');
});

test('すべての操作を変更でき、重複・キャンセル・左右のキーを扱える', async ({ page }) => {
  await page.goto('/');
  await openKeyboardSettings(page);
  for (const [action, key, label] of [
    ['left', 'KeyA', 'A'],
    ['right', 'KeyD', 'D'],
    ['soft', 'KeyS', 'S'],
    ['hard', 'Enter', 'Enter'],
    ['ccw', 'KeyQ', 'Q'],
    ['cw', 'KeyE', 'E'],
    ['hold', 'ShiftRight', '右Shift'],
    ['pause', 'KeyP', 'P'],
  ]) {
    await binding(page, action).click();
    await page.keyboard.press(key);
    await expect(binding(page, action)).toHaveText(label);
  }
  await binding(page, 'hold').click();
  await page.keyboard.press('KeyA');
  await expect(page.locator('#capture-status')).toContainText('左移動');
  await expect(binding(page, 'hold')).toHaveText('右Shift');
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await expect(page.locator('#capture-status')).toContainText('キャンセル');
  await binding(page, 'hold').click();
  await page.locator('#audio-tab').click();
  await page.keyboard.press('KeyC');
  await page.locator('#controller-tab').click();
  await expect(binding(page, 'hold')).toHaveText('右Shift');
  await page.locator('#settings-close').click();
  await startSolo(page);
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await page.keyboard.press('KeyP');
  await expect(page.locator('#board-overlay-0')).toContainText('PAUSED');
  await page.keyboard.press('KeyP');
  await expect(page.locator('#board-overlay-0')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
});

test('破損した保存内容でも初期キーで操作設定を開ける', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('stack-keyboard-v1', '{broken'));
  await page.goto('/');
  await openKeyboardSettings(page);
  await expect(binding(page, 'hold')).toHaveText('左Shift');
  await expect(page.locator('#mapping-grid button:enabled')).toHaveCount(8);
});

test('割り当てに使ったキーの長押しを再開後の操作へ持ち越さない', async ({ page }) => {
  await page.goto('/');
  await startSolo(page);
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  const before = await holdImage(page);
  await openKeyboardSettings(page);
  await binding(page, 'hold').click();
  await page.keyboard.down('KeyC');
  await expect(binding(page, 'hold')).toHaveText('C');
  await page.locator('#settings-close').click();
  await page.locator('#pause').click();
  await page.keyboard.down('KeyC'); // OSのキーリピートを再現する。
  await page.waitForTimeout(100);
  expect(await holdImage(page)).toBe(before);
  await page.keyboard.up('KeyC');
  await page.keyboard.press('KeyC');
  await expect.poll(() => holdImage(page)).not.toBe(before);
});
