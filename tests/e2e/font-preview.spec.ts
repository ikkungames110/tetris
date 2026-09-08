import { expect, test } from '@playwright/test';

test('ten actual fonts render and the chosen font can be tried in the game header', async ({
  page,
}) => {
  await page.goto('/font-preview/index.html');
  await expect(page.locator('.specimen')).toHaveCount(10);
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  const loaded = await page.evaluate(
    () => [...document.fonts].filter((font) => font.status === 'loaded').length,
  );
  expect(loaded).toBe(10);
  await page.getByRole('button', { name: '03 Rampart Oneをプレビュー' }).click();
  await expect(page.locator('#live-title')).toHaveCSS('font-family', 'Title-rampartone');
  await page.locator('#try-font').click();
  await expect(page.locator('.brand-title')).toHaveCSS('font-family', 'Title-rampartone');
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.fonts.check('26px "Title-rampartone"', 'テトクラ')),
  ).toBe(true);
  await page.goto('/font-preview/index.html');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
