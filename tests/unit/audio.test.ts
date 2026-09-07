import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BGM_FADE, Sound, spinSound } from '../../apps/web/audio';
import type { GameEvent } from '../../packages/core/types';

const param = () => ({
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
  cancelAndHoldAtTime: vi.fn(),
});
const makeGain = () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() });
const makeSource = () => ({
  buffer: null as { duration: number } | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  onended: null as (() => void) | null,
});
class Context {
  currentTime = 10;
  state = 'running';
  destination = {};
  gains: ReturnType<typeof makeGain>[] = [];
  sources: ReturnType<typeof makeSource>[] = [];
  resume = vi.fn(async () => {});
  suspend = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => ({ duration: 4 }));
  createGain() {
    const gain = makeGain();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource() {
    const source = makeSource();
    this.sources.push(source);
    return source;
  }
}
let context: Context;
let storage: Map<string, string>;
beforeEach(() => {
  context = new Context();
  storage = new Map();
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn() });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

it('defaults to disco and schedules overlapping fades without waiting for a timer', async () => {
  const sound = new Sound();
  expect(sound.settings.track).toBe('picopicodisco');
  sound.unlock();
  await settle();
  expect(context.sources).toHaveLength(2);
  expect(context.sources[0].start).toHaveBeenCalledWith(10.02);
  expect(context.sources[1].start).toHaveBeenCalledWith(14.02 - BGM_FADE);
  expect(context.gains[2].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 14.02);
  expect(context.gains[3].gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 14.02);
  context.currentTime = 14.02;
  context.sources[0].onended!();
  await settle();
  expect(context.sources).toHaveLength(3);
  expect(context.sources[2].start.mock.calls[0][0]).toBeCloseTo(17.42);
});

it('cancels queued music on rapid track changes and keeps random tracks distinct', async () => {
  const sound = new Sound();
  sound.unlock();
  await settle();
  context.currentTime = 11;
  sound.select('chess');
  sound.select('random');
  await settle();
  expect(context.sources[0].stop).toHaveBeenCalledWith(11.3);
  expect(context.sources[1].stop).toHaveBeenCalledWith();
  expect(context.sources).toHaveLength(4);
  expect(context.sources[2].buffer).not.toBe(context.sources[3].buffer);
});

it('persists independent volumes and mute without losing the chosen track', async () => {
  const sound = new Sound();
  sound.unlock();
  await settle();
  sound.setVolume('bgm', 0.2);
  sound.setVolume('se', 0.8);
  expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0.2, 10, 0.025);
  expect(context.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0.8, 10, 0.025);
  sound.enabled = false;
  expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10, 0.025);
  expect(context.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10, 0.025);
  expect(new Sound().settings).toEqual({
    enabled: false,
    track: 'picopicodisco',
    bgmVolume: 0.2,
    seVolume: 0.8,
  });
});

it('reports a failed track download without throwing', async () => {
  const status = vi.fn();
  const sound = new Sound(status);
  sound.unlock();
  await settle();
  vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  // Switch to an uncached track and report the failure without throwing.
  sound.select('chess');
  await settle();
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('読み込めませんでした'));
});

it('uses all four T-spin clips, including mini without a clear, and routes them to SE gain', async () => {
  const sound = new Sound();
  sound.unlock();
  await settle();
  for (const [spin, amount, clip] of [
    ['mini', 0, 't_spin_mini'],
    ['mini', 2, 't_spin_mini'],
    ['full', 1, 't_spin_single'],
    ['full', 2, 't_spin_double'],
    ['full', 3, 't_spin_triple'],
  ] as const) {
    const event: GameEvent = {
      id: 1,
      tick: 1,
      player: 0,
      type: amount ? 'clear' : 'lock',
      spin,
      amount,
    };
    expect(spinSound(event)).toBe(clip);
    sound.play(event);
    await settle();
    expect(context.sources.at(-1)!.connect).toHaveBeenCalledWith(context.gains[1]);
  }
  expect(spinSound({ id: 1, tick: 1, player: 0, type: 'clear', amount: 2 })).toBeNull();
});

it('loops the current track if preloading the next random track fails', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes('chess')) throw new Error('offline');
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) } as Response;
  });
  const status = vi.fn();
  const sound = new Sound(status);
  sound.select('random');
  await settle();
  expect(context.sources).toHaveLength(2);
  expect(context.sources[1].buffer).toBe(context.sources[0].buffer);
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('現在の曲をループ'));
});
