import { expect, test } from '@playwright/test';
import { stateHash, stepMatch } from '../../packages/core/engine';
import { newReplay, recordTick } from '../../packages/core/replay';
import { prepareTemplatePiece, templateCases, templateMatch } from '../helpers/templates';

for (const example of templateCases)
  test(`${example.name}の連携成立を表示し、専用MP3を再生する`, async ({ page }) => {
    const reference = templateMatch(example);
    reference.players[0].active = null;
    const replay = newReplay('practice', 42);
    for (let frame = 1; frame <= 160; frame++) {
      if (frame === 61 || frame === 121)
        prepareTemplatePiece(reference.players[0], example, frame === 61 ? 0 : 1);
      const inputs = [
        { held: 0, pressed: frame === 61 || frame === 121 ? 8 : 0 },
        { held: 0, pressed: 0 },
      ] as const;
      recordTick(replay, [...inputs]);
      stepMatch(reference, inputs);
    }
    replay.finalHash = stateHash(reference);
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        request.resourceType() === 'fetch' &&
        new URL(request.url()).pathname.endsWith('.mp3') &&
        request.url().includes('/templete/')
      )
        requests.push(decodeURIComponent(request.url()));
    });
    await page.goto('/');
    await page.locator('#settings-open').click();
    expect(requests).toEqual([]);
    await page.evaluate(async (id) => {
      const replayPath = '/packages/core/replay.ts';
      const helperPath = '/tests/helpers/templates.ts';
      const audioPath = '/apps/web/audio.ts';
      const { ReplayPlayer } = await import(replayPath);
      const { prepareTemplatePiece, templateCases, templateMatch } = await import(helperPath);
      const { Sound, clearSound } = await import(audioPath);
      const example = templateCases.find((t: { id: string }) => t.id === id);
      const voices: (string | null)[] = [];
      const starts: number[] = [];
      Object.assign(window, { templateVoices: voices, templateStarts: starts });
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
      let frame = 0;
      const originalStep = ReplayPlayer.prototype.step;
      ReplayPlayer.prototype.step = function (...args: Parameters<typeof originalStep>) {
        if (++frame === 1) {
          this.match = templateMatch(example);
          this.match.players[0].active = null;
        }
        if (frame === 61 || frame === 121)
          prepareTemplatePiece(this.match.players[0], example, frame === 61 ? 0 : 1);
        return originalStep.apply(this, args);
      };
    }, example.id);
    await page.locator('#replay-file').setInputFiles({
      name: `${example.id}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(replay)),
    });
    await expect(page.locator('#clear-0')).toHaveText(
      example.rows[0].length === 3 ? 'T-SPIN TRIPLE' : 'T-SPIN DOUBLE',
    );
    await expect(page.locator('#clear-0')).toHaveText(example.name);
    await expect(page.locator('#lines-0')).toHaveText(String(example.rows[0].length + 2));
    await expect(page.locator('#notice')).toContainText('記録と盤面の一致');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain(`/templete/${example.name}/${example.name}.mp3`);
    const observed = await page.evaluate(async (name) => {
      const context = new AudioContext();
      try {
        const buffer = await context.decodeAudioData(
          await (
            await fetch(`/src/templete/${encodeURIComponent(name)}/${encodeURIComponent(name)}.mp3`)
          ).arrayBuffer(),
        );
        const state = window as unknown as {
          templateVoices: (string | null)[];
          templateStarts: number[];
        };
        return {
          voices: state.templateVoices,
          playedVoice: state.templateStarts.some(
            (duration) => Math.abs(duration - buffer.duration) < 0.001,
          ),
        };
      } finally {
        await context.close();
      }
    }, example.name);
    expect(observed.voices).toEqual([
      example.rows[0].length === 3 ? 't_spin_triple' : 't_spin_double',
      `template:${example.id}`,
    ]);
    expect(observed.playedVoice).toBe(true);
    expect(errors).toEqual([]);
  });
