import type { Page } from '@playwright/test';

export async function startSolo(page: Page): Promise<void> {
  if ((await page.locator('#sprint').getAttribute('aria-pressed')) === 'true')
    await page.locator('#start').click();
  else await page.locator('#practice').click();
}
