import { chromium } from '@playwright/test';
import { cpus } from 'node:os';

// 開発サーバーを起動してから実行する。計測には描画や通信を含めない。
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5179');
  const session = await page.context().newCDPSession(page);
  const results = [];
  for (const slowdown of [1, 4]) {
    await session.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
    results.push(
      ...(await page.evaluate(async (slowdown) => {
        const { compiledTemplates, recognizeTemplate } =
          await import('/packages/core/templates.ts');
        const { cells, HIDDEN } = await import('/packages/core/pieces.ts');
        const { dtCanonMatch } = await import('/tests/helpers/dt-canon.ts');
        const results = [];
        for (const count of [1, 10, 100, 1000]) {
          const templates = Array.from({ length: count }, () =>
            structuredClone(compiledTemplates[0]),
          );
          const player = dtCanonMatch(2).players[0];
          // 最後の行だけ不一致にし、早期一致や候補数上限で負荷が過小にならないようにする。
          player.board[39][3] = null;
          for (const [x, y] of cells(player.active)) player.board[y + HIDDEN][x] = 'T';
          const run = () => recognizeTemplate(player, [33, 34], 'full', templates);
          for (let i = 0; i < 200; i++) run();
          const samples = [];
          for (let batch = 0; batch < 30; batch++) {
            const start = performance.now();
            for (let i = 0; i < 100; i++) run();
            samples.push((performance.now() - start) / 100);
          }
          samples.sort((a, b) => a - b);
          results.push({
            count,
            slowdown,
            medianMs: samples[15],
            p95BatchMs: samples[28],
            maxBatchMs: samples.at(-1),
          });
        }
        return results;
      }, slowdown)),
    );
  }
  console.log(
    JSON.stringify({ cpu: cpus()[0].model, browser: browser.version(), results }, null, 2),
  );
} finally {
  await browser.close();
}
