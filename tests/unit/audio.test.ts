import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BGM_FADE,
  Sound,
  clearSound,
  eventSounds,
  spinSound,
  clearPlaybackRate,
  seGainForVolume,
} from '../../apps/web/audio';
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
  playbackRate: param(),
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

it('loads template voices only after a matching Double and keeps their playback pitch unchanged', async () => {
  const sound = new Sound();
  sound.unlock();
  await settle();
  const templateRequests = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url]) => String(url).includes('DT%20canon') || String(url).includes('DT canon'),
      );
  expect(templateRequests()).toHaveLength(0);
  sound.prepareTemplates([{ id: 'dt-canon', variant: 0, x: 0, y: 33, step: 1 }]);
  await settle();
  expect(templateRequests()).toHaveLength(1);
  sound.play({
    id: 1,
    tick: 1,
    player: 0,
    type: 'clear',
    spin: 'full',
    amount: 3,
    ren: 2,
    template: 'dt-canon',
  });
  await settle();
  expect(templateRequests()).toHaveLength(1);
  expect(context.sources.at(-2)!.playbackRate.setValueAtTime).toHaveBeenCalledWith(
    clearPlaybackRate(2),
    expect.any(Number),
  );
  expect(context.sources.at(-1)!.playbackRate.setValueAtTime).toHaveBeenCalledWith(
    1,
    expect.any(Number),
  );
});

it('defaults to disco and schedules overlapping fades without waiting for a timer', async () => {
  const sound = new Sound();
  expect(sound.settings.track).toBe('picopicodisco');
  expect(sound.settings.bgmVolume).toBe(0.5);
  sound.unlock();
  await settle();
  expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0.05, 10, 0.025);
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
  expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(
    0.020000000000000004,
    10,
    0.025,
  );
  expect(context.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(
    expect.closeTo(0.88),
    10,
    0.025,
  );
  sound.enabled = false;
  expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10, 0.025);
  expect(context.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10, 0.025);
  expect(new Sound().settings).toEqual({
    enabled: false,
    track: 'picopicodisco',
    bgmVolume: 0.2,
    seVolume: 0.8,
    rotationSound: '03',
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
    expect(context.sources.at(-1)!.connect).toHaveBeenCalledWith(context.gains.at(-1));
    expect(context.gains.at(-1)!.connect).toHaveBeenCalledWith(context.gains[1]);
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

it('plays the supplied four-line clip once through SE gain and respects mute', async () => {
  const sound = new Sound();
  sound.unlock();
  await settle();
  const event: GameEvent = { id: 1, tick: 1, player: 0, type: 'clear', amount: 4 };
  expect(clearSound(event)).toBe('4LINES');
  for (const amount of [1, 2, 3]) expect(clearSound({ ...event, amount })).toBeNull();
  expect(clearSound({ ...event, type: 'garbage' })).toBeNull();
  expect(clearSound({ ...event, amount: 2, spin: 'full' })).toBe('t_spin_double');
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/4LINES.mp3'));
  const before = context.sources.length;
  sound.play(event);
  await settle();
  expect(context.sources).toHaveLength(before + 2);
  const source = context.sources.at(-1)!;
  expect(source.connect).toHaveBeenCalledWith(context.gains.at(-1));
  expect(context.gains.at(-1)!.connect).toHaveBeenCalledWith(context.gains[1]);
  expect(source.start).toHaveBeenCalledOnce();
  source.onended!();
  expect(source.disconnect).toHaveBeenCalledOnce();
  sound.setVolume('se', 0);
  sound.play(event);
  sound.setVolume('se', 0.7);
  sound.enabled = false;
  sound.play(event);
  await settle();
  expect(context.sources).toHaveLength(before + 2);
});

it('uses A for every event and gives Perfect clear priority over other clear sounds', async () => {
  const base: GameEvent = { id: 1, tick: 1, player: 0, type: 'clear', amount: 1 };
  expect(eventSounds({ ...base, type: 'lock', amount: 0 })).toEqual(['lock_a']);
  expect(eventSounds(base)).toEqual(['clear_a']);
  expect(eventSounds({ ...base, spin: 'full', amount: 2 })).toEqual([
    'clear_tspin_a',
    't_spin_double',
  ]);
  expect(eventSounds({ ...base, amount: 4 })).toEqual(['clear_four_a', '4LINES']);
  for (const amount of [1, 2, 3, 4])
    expect(eventSounds({ ...base, amount, spin: 'full', perfect: true })).toEqual([
      'perfect_clear_a',
      'Perfect_clear',
    ]);
  const sound = new Sound();
  sound.unlock();
  await settle();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/perfect_clear_a.mp3'));
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/Perfect_clear.mp3'));
  const before = context.sources.length;
  sound.play({ ...base, amount: 4, perfect: true });
  await settle();
  expect(context.sources).toHaveLength(before + 2);
  expect(context.sources.at(-1)!.start).toHaveBeenCalledWith(10.005);
  expect(context.sources.at(-2)!.start).toHaveBeenCalledWith(10.005);
  sound.rotate('none');
  sound.rotate('full');
  await settle();
  expect(context.sources).toHaveLength(before + 4);
  expect(context.sources.at(-1)!.buffer).not.toBe(context.sources.at(-2)!.buffer);
  sound.play(base);
  sound.setVolume('se', 0);
  await settle();
  expect(context.sources).toHaveLength(before + 4);
});

it('still plays the Perfect clear fanfare if its voice download fails', async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes('/Perfect_clear.mp3')) throw new Error('offline');
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) } as Response;
  });
  const status = vi.fn();
  const sound = new Sound(status);
  sound.unlock();
  await settle();
  const before = context.sources.length;
  sound.play({ id: 1, tick: 1, player: 0, type: 'clear', amount: 2, perfect: true });
  await settle();
  expect(context.sources).toHaveLength(before + 1);
  expect(status).toHaveBeenCalledWith('効果音を読み込めませんでした。');
});

it('defaults old or invalid settings to 03, persists all three choices and attenuates only 08', async () => {
  storage.set('tetcla-audio-v1', JSON.stringify({ track: 'chess', rotationSound: 'unknown' }));
  const sound = new Sound();
  expect(sound.settings.rotationSound).toBe('03');
  expect(sound.settings.track).toBe('chess');
  sound.unlock();
  await settle();
  const buffers = [];
  for (const [id, gain] of [
    ['03', 0.85],
    ['08', 0.55],
    ['10', 0.85],
  ] as const) {
    sound.selectRotation(id);
    expect(new Sound().settings.rotationSound).toBe(id);
    sound.rotate('none');
    await settle();
    buffers.push(context.sources.at(-1)!.buffer);
    expect(context.gains.at(-1)!.gain.setValueAtTime).toHaveBeenCalledWith(gain, 10.005);
    expect(context.gains.at(-1)!.connect).toHaveBeenCalledWith(context.gains[1]);
  }
  expect(new Set(buffers).size).toBe(3);
  sound.selectRotation('invalid');
  expect(sound.settings.rotationSound).toBe('10');
  sound.selectRotation('08');
  sound.rotate('full');
  await settle();
  expect(context.gains.at(-1)!.gain.setValueAtTime).toHaveBeenCalledWith(0.85, 10.005);
  const before = context.sources.length;
  sound.setVolume('se', 0);
  sound.previewRotation();
  await settle();
  expect(context.sources).toHaveLength(before);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/rotate_a.mp3'))).toBe(
    false,
  );
});

for (const [oldVolume, expected] of [
  [0.4, 0.5],
  [0.05, 0.5],
  [0, 0],
  [0.02, 0.2],
  [1, 1],
]) {
  it(`migrates old BGM volume ${oldVolume} to ${expected} and does not migrate twice`, () => {
    storage.set(
      'tetcla-audio-v1',
      JSON.stringify({ bgmVolume: oldVolume, seVolume: 0.8, track: 'chess' }),
    );
    const sound = new Sound();
    expect(sound.settings.bgmVolume).toBe(expected);
    expect(seGainForVolume(sound.settings.seVolume)).toBeCloseTo(0.8);
    sound.setVolume('bgm', expected);
    expect(new Sound().settings.bgmVolume).toBe(expected);
  });
}

it('keeps the old default SE loudness at the new 50% and migrates saved levels once', async () => {
  const sound = new Sound();
  expect(sound.settings.seVolume).toBe(0.5);
  sound.unlock();
  await settle();
  expect(context.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0.7, 10, 0.025);
  for (const old of [0, 0.2, 0.7, 0.8, 1]) {
    storage.set('tetcla-audio-v1', JSON.stringify({ seVolume: old }));
    const migrated = new Sound();
    expect(seGainForVolume(migrated.settings.seVolume)).toBeCloseTo(old);
    migrated.setVolume('se', migrated.settings.seVolume);
    expect(new Sound().settings.seVolume).toBe(migrated.settings.seVolume);
  }
  expect(seGainForVolume(1)).toBe(1);
  expect(seGainForVolume(0)).toBe(0);
});

it('raises each consecutive clear effect by a semitone but leaves voices and lock sounds alone', async () => {
  const sound = new Sound();
  sound.unlock();
  await settle();
  let lastRate = 0;
  for (const ren of [0, 1, 2, 5, 12]) {
    sound.play({ id: ren + 1, tick: ren + 1, player: 0, type: 'clear', amount: 4, ren });
    await settle();
    const effectRate = context.sources.at(-2)!.playbackRate.setValueAtTime.mock.calls.at(-1)![0];
    expect(effectRate).toBeCloseTo(2 ** (ren / 12));
    expect(effectRate).toBeGreaterThan(lastRate);
    expect(context.sources.at(-1)!.playbackRate.setValueAtTime).toHaveBeenCalledWith(1, 10.005);
    lastRate = effectRate;
  }
  expect(clearPlaybackRate(100)).toBe(2);
  expect(clearPlaybackRate(NaN)).toBe(1);
  sound.play({ id: 99, tick: 99, player: 0, type: 'lock', amount: 0, ren: 12 });
  await settle();
  expect(context.sources.at(-1)!.playbackRate.setValueAtTime).toHaveBeenCalledWith(1, 10.005);
});
