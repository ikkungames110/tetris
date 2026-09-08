import { expect, test } from '@playwright/test';
import { createMatch, stateHash, stepMatch } from '../../packages/core/engine';
import { newReplay, recordTick } from '../../packages/core/replay';
import { Button, NO_INPUT, RULES } from '../../packages/core/types';
import lineClear from '../fixtures/line-clear.replay.json' with { type: 'json' };

test('対戦相手の音はライン消去だけを鳴らし、自分の回転・設置音は残す', async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await host.addInitScript(() => {
      crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
        (array as unknown as Uint32Array).fill(41);
        return array;
      };
    });
    for (const page of [host, guest]) {
      await page.goto('/');
      await page.evaluate(async () => {
        const path = '/apps/web/audio.ts';
        const { Sound } = await import(path);
        const events: { type: string; player: number }[] = [];
        const rotations: string[] = [];
        Object.assign(window, { versusAudio: { events, rotations } });
        Sound.prototype.play = (event: { type: string; player: number }) => events.push(event);
        Sound.prototype.rotate = (spin: string) => rotations.push(spin);
      });
    }
    await host.locator('#online').click();
    await host.locator('#room-create').click();
    await host.locator('#room-create-submit').click();
    await expect(host.locator('#room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
    await guest.locator('#online').click();
    await guest.locator('#room-join-open').click();
    await guest.locator('#room-code-input').fill((await host.locator('#room-code').textContent())!);
    await guest.locator('#room-join').click();
    await host.locator('#room-ready').click();
    await guest.locator('#room-ready').click();
    await expect(guest.locator('#board-overlay-1')).toBeHidden({ timeout: 7000 });
    const readAudio = (page: typeof host) =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              versusAudio: { events: { type: string; player: number }[]; rotations: string[] };
            }
          ).versusAudio,
      );
    await guest.keyboard.press('KeyX');
    await guest.waitForTimeout(100);
    await guest.keyboard.press('Space');
    await expect.poll(async () => (await readAudio(guest)).rotations.length).toBe(1);
    await expect
      .poll(async () =>
        (await readAudio(guest)).events.some((e) => e.type === 'lock' && e.player === 1),
      )
      .toBe(true);
    expect(await readAudio(host)).toEqual({ events: [], rotations: [] });

    // seed 42 の既存リプレイと同じ配置で、実際に1ラインを消す。
    const keys: Record<number, string> = {
      [Button.left]: 'ArrowLeft',
      [Button.right]: 'ArrowRight',
      [Button.hard]: 'Space',
    };
    for (const run of lineClear.rounds[0]) {
      const pressed = run.inputs[0].pressed;
      if (!pressed) continue;
      await host.keyboard.press(keys[pressed]);
      await host.waitForTimeout(65);
    }
    await expect(host.locator('#lines-0')).toHaveText('1');
    await expect
      .poll(async () =>
        (await readAudio(guest)).events.some((e) => e.type === 'clear' && e.player === 0),
      )
      .toBe(true);
    expect(
      (await readAudio(guest)).events
        .filter((e) => e.player === 0)
        .every((e) => e.type === 'clear'),
    ).toBe(true);
    await host.keyboard.press('KeyX');
    await expect.poll(async () => (await readAudio(host)).rotations.length).toBe(1);
    expect((await readAudio(guest)).rotations).toHaveLength(1);
    expect((await readAudio(host)).events.some((e) => e.type === 'lock' && e.player === 0)).toBe(
      true,
    );
  } finally {
    await host.close();
    await guest.close();
  }
});

test('BGMの実音源をデコードし、再生中に選曲・音量を変更して保存できる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (values: Uint32Array) => {
        values.fill(1);
        return values;
      },
    });
    const original = AudioContext.prototype.decodeAudioData;
    const durations: number[] = [];
    const starts: number[] = [];
    Object.assign(window, { audioDurations: durations, audioStarts: starts });
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      starts.push(this.buffer?.duration ?? 0);
      return start.apply(this, args);
    };
    AudioContext.prototype.decodeAudioData = function (data: ArrayBuffer) {
      return original.call(this, data).then((buffer) => {
        durations.push(buffer.duration);
        return buffer;
      });
    };
  });
  await page.goto('/');
  await expect(page.locator('#bgm-select')).toHaveValue('picopicodisco');
  await expect(page.locator('#bgm-select option')).toHaveCount(10);
  await page.locator('#start').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { audioDurations: number[] }).audioDurations.length,
      ),
    )
    .toBe(16);
  await expect(page.locator('#audio-status')).toBeHidden();
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await page.locator('#bgm-select').selectOption('chess');
  // 選曲は未消費の入力を解除するため、変更後に回転・設置を確認する。
  await page.keyboard.press('KeyX');
  await page.keyboard.press('Space');
  await expect(page.locator('#pps-0')).not.toHaveText('0.00');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const starts = (window as unknown as { audioStarts: number[] }).audioStarts;
        return [0.18, 0.132].every((duration) =>
          starts.some((value) => Math.abs(value - duration) < 0.002),
        );
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { audioDurations: number[] }).audioDurations.length,
      ),
    )
    .toBe(17);
  await page.locator('#bgm-select').selectOption('random');
  await page.locator('#settings-open').click();
  await expect(page.locator('#bgm-volume')).toBeVisible();
  await expect(page.locator('#device-0')).toBeHidden();
  await expect(page.locator('#bgm-volume')).toHaveValue('50');
  await expect(page.locator('#se-volume')).toHaveValue('50');
  await page.getByRole('tab', { name: 'コントローラー', exact: true }).click();
  await expect(page.locator('#device-0')).toBeVisible();
  await page.getByRole('tab', { name: '音量', exact: true }).click();
  for (const [kind, value] of [
    ['bgm', '23'],
    ['se', '81'],
  ]) {
    await page.locator(`#${kind}-volume`).fill(value);
    await expect(page.locator(`#${kind}-volume-value`)).toHaveText(`${value}%`);
  }
  await page.locator('#settings-close').click();
  await expect(page.locator('#sound')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#bgm-select')).toHaveValue('random');
  await expect(page.locator('#sound')).toHaveCount(0);
  await page.locator('#settings-open').click();
  await expect(page.locator('#bgm-volume')).toHaveValue('23');
  await expect(page.locator('#se-volume')).toHaveValue('81');
  expect(errors).toEqual([]);
});

test('旧ミュート設定を音量0で引き継ぎ、設定から音を戻せる', async ({ page }) => {
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'tetcla-audio-v1',
      JSON.stringify({ enabled: false, bgmVolume: 0.4, seVolume: 0.7 }),
    ),
  );
  await page.reload();
  await page.locator('#settings-open').click();
  await expect(page.locator('#bgm-volume')).toHaveValue('0');
  await expect(page.locator('#se-volume')).toHaveValue('0');
  await page.locator('#bgm-volume').fill('40');
  await page.reload();
  await page.locator('#settings-open').click();
  await expect(page.locator('#bgm-volume')).toHaveValue('40');
  await expect(page.locator('#se-volume')).toHaveValue('0');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('tetcla-audio-v1')!).enabled),
  ).toBe(true);
});

test('リプレイの最終tickの回転音を一度だけ鳴らす', async ({ page }) => {
  const match = createMatch('practice', 1);
  const replay = newReplay('practice', 1);
  for (let tick = 0; tick <= RULES.countdown; tick++) {
    const inputs = [
      tick === RULES.countdown ? { held: 0, pressed: Button.cw } : NO_INPUT,
      NO_INPUT,
    ] as const;
    recordTick(replay, [...inputs]);
    stepMatch(match, inputs);
  }
  replay.finalHash = stateHash(match);
  await page.addInitScript(() => {
    const starts: number[] = [];
    Object.assign(window, { replayAudioStarts: starts });
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof original>) {
      starts.push(this.buffer?.duration ?? 0);
      return original.apply(this, args);
    };
  });
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.goto('/');
  await page.locator('#settings-open').click();
  await page.locator('#replay-file').setInputFiles({
    name: 'last-rotation.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(replay)),
  });
  await expect(page.locator('#notice')).toContainText('記録と盤面の一致', { timeout: 7000 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { replayAudioStarts: number[] }).replayAudioStarts.filter(
            (duration) => Math.abs(duration - 0.18) < 0.002,
          ).length,
      ),
    )
    .toBe(1);
});

test('開発用の回転音03・08・10を試聴・保存してプレイに反映できる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (values: Uint32Array) => {
        values.fill(1);
        return values;
      },
    });
    const starts: number[] = [];
    Object.assign(window, { rotationStarts: starts });
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof original>) {
      starts.push(this.buffer?.duration ?? 0);
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await page.locator('#settings-open').click();
  await expect(page.locator('#rotation-sound')).toHaveValue('03');
  await expect(page.locator('#rotation-sound option')).toHaveCount(3);
  for (const [id, duration] of [
    ['03', 0.18],
    ['08', 0.14],
    ['10', 0.26],
  ] as const) {
    await page.locator('#rotation-sound').selectOption(id);
    await page.locator('#rotation-sound-preview').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { rotationStarts: number[] }).rotationStarts
            .filter((duration) => duration < 1)
            .at(-1),
        ),
      )
      .toBeCloseTo(duration, 3);
  }
  await page.reload();
  await expect(page.locator('#rotation-sound')).toHaveValue('10');
  await page.locator('#start').click();
  await expect(page.locator('#board-overlay-0')).toBeHidden({ timeout: 6000 });
  await page.keyboard.press('KeyX');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { rotationStarts: number[] }).rotationStarts
          .filter((duration) => duration < 1)
          .at(-1),
      ),
    )
    .toBeCloseTo(0.26, 3);
  await page.locator('#settings-open').click();
  await page.locator('#se-volume').fill('0');
  const before = await page.evaluate(
    () => (window as unknown as { rotationStarts: number[] }).rotationStarts.length,
  );
  await page.locator('#rotation-sound-preview').click();
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(
      () => (window as unknown as { rotationStarts: number[] }).rotationStarts.length,
    ),
  ).toBe(before);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator('#rotation-sound')).toBeVisible();
  await expect(page.locator('#rotation-sound-preview')).toBeVisible();
  expect(
    await page
      .locator('#settings-dialog')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(errors).toEqual([]);
});
