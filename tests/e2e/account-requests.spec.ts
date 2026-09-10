import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { completedSprint } from '../helpers/sprint';
import fixture from '../fixtures/sprint-clear.json' with { type: 'json' };

async function visit(page: Page) {
  // 製品側にはテスト用のグローバルを追加せず、実際の完了時と同じ保存処理を呼ぶ。
  await page.route('**/apps/web/main.ts', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nexport { accounts };\n` });
  });
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/'))
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/apps/web/main.ts';
    await (
      await import(path)
    ).accounts.ready;
  });
  expect(requests).toEqual(['POST /api/v1/session']);
  return requests;
}

async function saveSprint(page: Page, extraTicks: number, copies = 1) {
  await page.evaluate(
    async ({ replay, ticks, copies }) => {
      const path = '/apps/web/main.ts';
      const { accounts } = await import(path);
      await Promise.all(
        Array.from({ length: copies }, () => accounts.save(replay, accounts.state.user.id, ticks)),
      );
    },
    { replay: completedSprint(extraTicks), ticks: fixture.roundTicks + extraTicks, copies },
  );
}

test('初回取得後は画面移動・フォーカス復帰で再取得せず、登録とログインは各1回で全記録を反映する', async ({
  page,
}) => {
  const requests = await visit(page);
  await saveSprint(page, 0);
  requests.length = 0;
  for (let i = 0; i < 3; i++) {
    await page.locator('#mypage-open').click();
    await expect(page.locator('#mypage-best')).toHaveText('00:15.616');
    await page.locator('#mypage-close').click();
    await page.locator('#ranking-open').click();
    await page.locator('#ranking-random-tab').click();
    await page.locator('#ranking-sprint-tab').click();
    await page.locator('#ranking-close').click();
    await page.locator('#settings-open').click();
    await page.locator('#controller-tab').click();
    await page.locator('#settings-close').click();
    await page.locator('#help-open').click();
    await page.locator('#help-close').click();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('#sprint').click();
    await page.locator('#practice').click();
  }
  expect(requests).toEqual([]);
  const email = `${randomUUID()}@example.test`;
  await page.locator('#login-open').click();
  await page.locator('#account-register').click();
  await page.locator('#account-email').fill(email);
  await page.locator('#account-password').fill('a');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-dialog')).toBeHidden();
  expect(requests).toEqual(['POST /api/v1/register']);
  await page.locator('#login-open').click();
  await page.locator('#account-logout').click();
  await expect(page.locator('#account-dialog')).toBeHidden();
  requests.length = 0;
  await page.locator('#login-open').click();
  await page.locator('#account-email').fill(email);
  await page.locator('#account-password').fill('a');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-dialog')).toBeHidden();
  await page.locator('#mypage-open').click();
  await expect(page.locator('#mypage-best')).toHaveText('00:15.616');
  await expect(page.locator('#mypage-matches')).toHaveText('0');
  expect(requests).toEqual(['POST /api/v1/login']);
});

test('40LINEは更新だけをPOSTし、同タイム・遅いタイム・同時保存を送らない', async ({ page }) => {
  const requests = await visit(page);
  const ranking = await page.locator('#ranking-sprint-mine').textContent();
  requests.length = 0;
  await saveSprint(page, 60, 3);
  await saveSprint(page, 60);
  await saveSprint(page, 90);
  expect(requests).toEqual(['POST /api/v1/records/40line']);
  await saveSprint(page, 30);
  await saveSprint(page, 0);
  await expect(page.locator('#mypage-best')).toHaveText('00:15.616');
  expect(requests).toEqual(Array(3).fill('POST /api/v1/records/40line'));
  await expect(page.locator('#ranking-sprint-mine')).toHaveText(ranking!);
});

test('保存失敗後は自動再送せず、再保存操作だけで40LINEを再送できる', async ({ page }) => {
  const requests = await visit(page);
  await page.route('**/api/v1/records/40line', (route) => route.abort(), { times: 1 });
  requests.length = 0;
  await saveSprint(page, 0);
  await page.locator('#sprint').click();
  await expect(page.locator('#best-retry')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(requests).toEqual(['POST /api/v1/records/40line']);
  await page.locator('#best-retry').click();
  await expect(page.locator('#best-time')).toHaveText('00:15.616');
  await saveSprint(page, 0);
  expect(requests).toEqual(Array(2).fill('POST /api/v1/records/40line'));
});

test('ランダム対戦は1試合1POST、保存失敗時だけ手動再送する', async ({ page }) => {
  const requests = await visit(page);
  const state = await page.evaluate(async () => {
    const path = '/apps/web/main.ts';
    return (await import(path)).accounts.state;
  });
  const seen = new Set<string>();
  await page.route('**/api/v1/records/random', async (route) => {
    const result = route.request().postDataJSON();
    seen.add(result.matchId);
    await route.fulfill({ json: { ...state, randomStats: { matches: seen.size, wins: 1 } } });
  });
  requests.length = 0;
  const result = { matchId: randomUUID(), seat: 0, wins: [3, 1] };
  const save = async (result: { matchId: string; seat: number; wins: number[] }) =>
    page.evaluate(async (result) => {
      const path = '/apps/web/main.ts';
      const { accounts } = await import(path);
      await Promise.all([0, 1].map(() => accounts.saveRandom(result, accounts.state.user.id)));
    }, result);
  await save(result);
  await save(result);
  expect(requests).toEqual(['POST /api/v1/records/random']);
  await expect(page.locator('#mypage-matches')).toHaveText('1');
  await page.route('**/api/v1/records/random', (route) => route.abort(), { times: 1 });
  const loss = { ...result, matchId: randomUUID(), wins: [0, 3] };
  await save(loss);
  await page.locator('#mypage-open').click();
  await expect(page.locator('#mypage-record-retry')).toBeVisible();
  expect(requests).toEqual(Array(2).fill('POST /api/v1/records/random'));
  await page.locator('#mypage-record-retry').click();
  await expect(page.locator('#mypage-matches')).toHaveText('2');
  await expect(page.locator('#mypage-win-rate')).toHaveText('50.0%');
  await save(loss);
  expect(requests).toEqual(Array(3).fill('POST /api/v1/records/random'));
});
