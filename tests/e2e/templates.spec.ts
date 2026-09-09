import { expect, test } from '@playwright/test';
import { stateHash, stepMatch } from '../../packages/core/engine';
import { newReplay, recordTick } from '../../packages/core/replay';
import { dtCanonMatch, dtDouble, dtTriple } from '../helpers/dt-canon';

test('DT canon成立時に実ゲームの消去表示と専用ボイスを出す', async ({ page }) => {
  const reference = dtCanonMatch();
  reference.players[0].active = null;
  const replay = newReplay('practice', 42);
  for (let frame = 1; frame <= 160; frame++) {
    if (frame === 61) {
      reference.players[0].active = dtDouble();
      reference.players[0].rotationKick = 0;
    }
    if (frame === 121) dtTriple(reference.players[0]);
    const inputs = [
      { held: 0, pressed: frame === 61 || frame === 121 ? 8 : 0 },
      { held: 0, pressed: 0 },
    ] as const;
    recordTick(replay, [...inputs]);
    stepMatch(reference, inputs);
  }
  replay.finalHash = stateHash(reference);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#debug-messages')).toHaveCount(0);
  await page.locator('#settings-open').click();
  await page.evaluate(async () => {
    const replayPath = '/packages/core/replay.ts';
    const helperPath = '/tests/helpers/dt-canon.ts';
    const audioPath = '/apps/web/audio.ts';
    const { ReplayPlayer } = await import(replayPath);
    const { dtCanonMatch, dtDouble, dtTriple } = await import(helperPath);
    const { Sound, clearSound } = await import(audioPath);
    const voices: (string | null)[] = [];
    const starts: number[] = [];
    Object.assign(window, { dtVoices: voices, dtStarts: starts });
    const originalPlay = Sound.prototype.play;
    Sound.prototype.play = function (event: Parameters<typeof clearSound>[0]) {
      voices.push(clearSound(event));
      return originalPlay.call(this, event);
    };
    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof originalStart>) {
      starts.push(this.buffer?.duration ?? 0);
      return originalStart.apply(this, args);
    };
    // 開始盤面だけをテスト用に準備し、消去・描画・音声は実装本体を通す。
    let frame = 0;
    const originalStep = ReplayPlayer.prototype.step;
    ReplayPlayer.prototype.step = function (...args: Parameters<typeof originalStep>) {
      if (++frame === 1) {
        this.match = dtCanonMatch();
        this.match.players[0].active = null;
      }
      if (frame === 61) {
        this.match.players[0].active = dtDouble();
        this.match.players[0].rotationKick = 0;
      }
      if (frame === 121) dtTriple(this.match.players[0]);
      return originalStep.apply(this, args);
    };
  });
  await page.locator('#replay-file').setInputFiles({
    name: 'dt-canon.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(replay)),
  });
  await expect(page.locator('#lines-0')).toHaveText('0');
  await expect(page.locator('#clear-0')).toHaveText('');
  await expect(page.locator('#clear-0')).toHaveText('T-SPIN DOUBLE');
  await expect(page.locator('#lines-0')).toHaveText('2');
  await expect(page.locator('#clear-0')).toHaveText('DT canon');
  await expect(page.locator('#notice')).toContainText('記録と盤面の一致');
  const observed = await page.evaluate(async () => {
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(
        await (await fetch('/src/templete/DT%20canon/DT_canon1.mp3')).arrayBuffer(),
      );
      const state = window as unknown as { dtVoices: (string | null)[]; dtStarts: number[] };
      return {
        voices: state.dtVoices,
        playedVoice: state.dtStarts.some(
          (duration) => Math.abs(duration - buffer.duration) < 0.001,
        ),
      };
    } finally {
      await context.close();
    }
  });
  expect(observed.voices).toEqual(['t_spin_double', 'template:dt-canon']);
  expect(observed.playedVoice).toBe(true);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#debug-messages')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/dt-canon-mobile.png' });
  await page.locator('#start').click();
});
