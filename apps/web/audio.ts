import type { GameEvent, Spin, TemplateProgress } from '../../packages/core/types';
import { templateDefinitions, templateName } from '../../packages/core/templates';

const bgmFiles = import.meta.glob('../../src/bgm/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const seFiles = import.meta.glob('../../src/se/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const seUrls: Record<string, string> = Object.fromEntries(
  Object.entries(seFiles).map(([path, url]) => [path.split('/').at(-1)!.replace('.mp3', ''), url]),
);
const templateVoices = import.meta.glob('../../src/templete/*/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
for (const template of templateDefinitions) {
  const url = templateVoices[`../../src/templete/${template.name}/${template.name}.mp3`];
  if (url) seUrls[`template:${template.id}`] = url;
}
for (const kind of ['lock', 'rotate_tspin', 'clear', 'clear_tspin', 'clear_four', 'perfect_clear'])
  seUrls[`${kind}_a`] = `${import.meta.env.BASE_URL}se-preview/${kind}_a.mp3`;
export const ROTATION_SOUNDS = [
  { id: '03', name: '03：小さな泡', clip: '03_micro_bubbles', gain: 0.85 },
  { id: '08', name: '08：小粒シェイカー（音量控えめ）', clip: '08_soft_shaker', gain: 0.55 },
  { id: '10', name: '10：クラウド・シンセ', clip: '10_cloud_chord', gain: 0.85 },
] as const;
type RotationSoundId = (typeof ROTATION_SOUNDS)[number]['id'];
const validRotationSound = (value: unknown): value is RotationSoundId =>
  ROTATION_SOUNDS.some((sound) => sound.id === value);
for (const sound of ROTATION_SOUNDS)
  seUrls[sound.clip] = `${import.meta.env.BASE_URL}rotation-preview/${sound.clip}.mp3`;
export const BGM_TRACKS = [
  ['picopicodisco', 'ピコピコディスコ'],
  ['chess', 'CHESS'],
  ['emerald', 'エメラルド'],
  ['energy', 'ENERGY'],
  ['gozennijinofunsui', '午前二時の噴水'],
  ['kanatanouchuu', '彼方の宇宙'],
  ['latenightsnow', 'Late Night Snow'],
  ['seishishitauchu', '静止した宇宙'],
  ['sunadokeiseiun', '砂時計星雲'],
] as const;
export const BGM_FADE = 0.3;
const STORAGE_KEY = 'tetcla-audio-v1';
interface AudioSettings {
  enabled: boolean;
  track: string;
  bgmVolume: number;
  seVolume: number;
  rotationSound: RotationSoundId;
}
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  track: string;
  start: number;
  end: number;
  ended: boolean;
  advance?: () => void;
}
const validTrack = (track: unknown): track is string =>
  track === 'random' || BGM_TRACKS.some(([id]) => id === track);
const volume = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

// 連続消去ごとに半音ずつ上げ、1オクターブを上限にする。
export const clearPlaybackRate = (ren = 0): number =>
  2 ** (Math.min(12, Math.max(0, Number.isFinite(ren) ? ren : 0)) / 12);

// 旧70%の音の大きさを新50%に対応させ、100%は従来と同じ最大音量に保つ。
export const seGainForVolume = (value: number): number =>
  value <= 0.5 ? value * 1.4 : 0.7 + (value - 0.5) * 0.6;
const seVolumeForGain = (value: number): number =>
  value <= 0.7 ? value / 1.4 : 0.5 + (value - 0.7) / 0.6;

export function spinSound(event: GameEvent): string | null {
  if (event.type !== 'clear' && event.type !== 'lock') return null;
  if (event.spin === 'mini') return 't_spin_mini';
  if (event.spin !== 'full') return null;
  return { 1: 't_spin_single', 2: 't_spin_double', 3: 't_spin_triple' }[event.amount] ?? null;
}

export function clearSound(event: GameEvent): string | null {
  if (event.type === 'clear' && event.perfect) return 'Perfect_clear';
  if (
    event.type === 'clear' &&
    templateName(event.template) &&
    seUrls[`template:${event.template}`]
  )
    return `template:${event.template}`;
  if (event.type === 'clear' && event.amount === 4) return '4LINES';
  return spinSound(event);
}

export function eventSounds(event: GameEvent): string[] {
  const voice = clearSound(event);
  const effect =
    event.type === 'lock'
      ? 'lock_a'
      : event.type === 'clear'
        ? event.perfect
          ? 'perfect_clear_a'
          : event.amount === 4
            ? 'clear_four_a'
            : event.spin && event.spin !== 'none'
              ? 'clear_tspin_a'
              : 'clear_a'
        : null;
  return [...(effect ? [effect] : []), ...(voice ? [voice] : [])];
}

export class Sound {
  private preparedTemplates = new Set<string>();
  readonly settings: AudioSettings = {
    enabled: true,
    track: 'picopicodisco',
    bgmVolume: 0.5,
    seVolume: 0.5,
    rotationSound: '03',
  };
  private context: AudioContext | null = null;
  private bgmGain: GainNode | null = null;
  private seGain: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private voices = new Set<Voice>();
  private generation = 0;
  private starting = false;

  constructor(private onStatus: (message: string) => void = () => {}) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      if (typeof saved.enabled === 'boolean') this.settings.enabled = saved.enabled;
      if (validTrack(saved.track)) this.settings.track = saved.track;
      if (validRotationSound(saved.rotationSound))
        this.settings.rotationSound = saved.rotationSound;
      const savedBgm = volume(saved.bgmVolume, this.settings.bgmVolume);
      // 新しい50%を従来の5%相当にする。旧既定値は更新し、静かな設定とミュートは引き継ぐ。
      this.settings.bgmVolume =
        saved.bgmScaleVersion === 2
          ? savedBgm
          : typeof saved.bgmVolume !== 'number' ||
              !Number.isFinite(saved.bgmVolume) ||
              saved.bgmVolume === 0.4
            ? 0.5
            : Math.min(1, savedBgm * 10);
      this.settings.seVolume =
        saved.seScaleVersion === 2
          ? volume(saved.seVolume, 0.5)
          : seVolumeForGain(volume(saved.seVolume, 0.7));
    } catch {
      /* 保存できない環境でも音声を利用できる。 */
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.context?.suspend().catch(() => {});
      else if (this.context) this.unlock();
    });
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  set enabled(enabled: boolean) {
    this.settings.enabled = enabled;
    this.updateVolumes();
    this.save();
  }

  setVolume(kind: 'bgm' | 'se', value: number): void {
    const key = kind === 'bgm' ? 'bgmVolume' : 'seVolume';
    this.settings[key] = volume(value, this.settings[key]);
    this.updateVolumes();
    this.save();
  }

  selectRotation(id: string): void {
    if (!validRotationSound(id)) return;
    this.settings.rotationSound = id;
    this.save();
  }

  previewRotation(): void {
    this.unlock();
    void this.context
      ?.resume()
      .then(() => this.rotate('none'))
      .catch(() => {});
  }

  select(track: string): void {
    if (!validTrack(track) || track === this.settings.track) return;
    this.settings.track = track;
    this.generation++;
    this.starting = false;
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.voices) {
      voice.advance = undefined;
      if (voice.start > now) voice.source.stop();
      else {
        voice.gain.gain.cancelAndHoldAtTime(now);
        voice.gain.gain.linearRampToValueAtTime(0, now + BGM_FADE);
        voice.source.stop(now + BGM_FADE);
      }
    }
    this.voices.clear();
    this.save();
    this.unlock();
  }

  unlock(): void {
    if (!this.enabled || document.hidden) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.bgmGain = this.context.createGain();
        this.seGain = this.context.createGain();
        this.bgmGain.connect(this.context.destination);
        this.seGain.connect(this.context.destination);
        this.updateVolumes();
        for (const [clip, url] of Object.entries(seUrls))
          if (!clip.startsWith('template:')) void this.load(url).catch(() => {});
      }
      void this.context
        .resume()
        .then(() => this.startBgm())
        .catch(() => {});
    } catch {
      this.onStatus('このブラウザーでは音声を再生できません。');
    }
  }

  private save(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...this.settings, bgmScaleVersion: 2, seScaleVersion: 2 }),
      );
    } catch {
      /* セッション中の設定は保持する。 */
    }
  }

  private updateVolumes(): void {
    if (!this.context) return;
    this.bgmGain?.gain.setTargetAtTime(
      this.enabled ? this.settings.bgmVolume * 0.1 : 0,
      this.context.currentTime,
      0.025,
    );
    this.seGain?.gain.setTargetAtTime(
      this.enabled ? seGainForVolume(this.settings.seVolume) : 0,
      this.context.currentTime,
      0.025,
    );
  }

  private load(url: string): Promise<AudioBuffer> {
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`Audio: ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => this.context!.decodeAudioData(data))
        .catch((error: unknown) => {
          this.buffers.delete(url);
          throw error;
        });
      this.buffers.set(url, pending);
      // 長い曲のデコード済みデータは直近2曲まで。SEは小さいので保持する。
      const bgmUrls = new Set(Object.values(bgmFiles));
      const cached = [...this.buffers.keys()].filter((key) => bgmUrls.has(key));
      for (const key of cached.slice(0, -2)) this.buffers.delete(key);
    }
    return pending;
  }

  private nextTrack(previous?: string): string {
    if (this.settings.track !== 'random') return this.settings.track;
    const candidates = BGM_TRACKS.filter(([id]) => id !== previous);
    return candidates[Math.floor(Math.random() * candidates.length)][0];
  }

  private async startBgm(): Promise<void> {
    if (this.starting || this.voices.size || !this.enabled) return;
    this.starting = true;
    const generation = this.generation;
    const track = this.nextTrack();
    try {
      const buffer = await this.load(bgmFiles[`../../src/bgm/${track}.mp3`]);
      if (generation !== this.generation) return;
      const voice = this.schedule(track, buffer, this.context!.currentTime + 0.02);
      this.onStatus('');
      void this.queueNext(voice, generation);
    } catch {
      if (generation === this.generation)
        this.onStatus('BGMを読み込めませんでした。曲を選び直すと再試行できます。');
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  private schedule(track: string, buffer: AudioBuffer, start: number): Voice {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const end = start + buffer.duration;
    const fade = Math.min(BGM_FADE, buffer.duration / 2);
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(this.bgmGain!);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(1, start + fade);
    gain.gain.setValueAtTime(1, end - fade);
    gain.gain.linearRampToValueAtTime(0, end);
    const voice: Voice = { source, gain, track, start, end, ended: false };
    this.voices.add(voice);
    source.onended = () => {
      voice.ended = true;
      this.voices.delete(voice);
      source.disconnect();
      gain.disconnect();
      voice.advance?.();
    };
    source.start(start);
    return voice;
  }

  private async queueNext(current: Voice, generation: number): Promise<void> {
    const track = this.nextTrack(current.track);
    try {
      const buffer = await this.load(bgmFiles[`../../src/bgm/${track}.mp3`]);
      if (generation !== this.generation) return;
      const next = this.schedule(
        track,
        buffer,
        Math.max(
          current.end - Math.min(BGM_FADE, buffer.duration / 2, (current.end - current.start) / 2),
          this.context!.currentTime + 0.02,
        ),
      );
      const advance = () => {
        void this.queueNext(next, generation);
      };
      if (current.ended) advance();
      else current.advance = advance;
    } catch {
      if (generation !== this.generation) return;
      // 次曲の取得失敗時は再生中の曲をループし、音切れを避ける。
      this.onStatus('次のBGMを読み込めないため、現在の曲をループします。');
      const next = this.schedule(
        current.track,
        current.source.buffer!,
        Math.max(current.end - BGM_FADE, this.context!.currentTime + 0.02),
      );
      const advance = () => {
        void this.queueNext(next, generation);
      };
      if (current.ended) advance();
      else current.advance = advance;
    }
  }

  rotate(spin: Spin): void {
    const selected = ROTATION_SOUNDS.find((sound) => sound.id === this.settings.rotationSound)!;
    this.playClips([spin === 'none' ? selected.clip : 'rotate_tspin_a']);
  }

  // 成立候補のボイスだけを先読みし、テンプレート追加で初回ロードを増やさない。
  prepareTemplates(progress: TemplateProgress[] = []): void {
    if (!this.context || !this.enabled || !this.settings.seVolume) return;
    for (const { id } of progress) {
      const url = seUrls[`template:${id}`];
      if (url && !this.preparedTemplates.has(id)) {
        this.preparedTemplates.add(id);
        void this.load(url).catch(() => {});
      }
    }
  }

  private playClips(clips: string[], effectRate = 1): void {
    if (!this.enabled || !this.settings.seVolume || this.context?.state !== 'running') return;
    const ctx = this.context;
    void Promise.allSettled(clips.map((clip) => this.load(seUrls[clip]))).then((results) => {
      if (!this.enabled || !this.settings.seVolume || document.hidden || ctx.state !== 'running')
        return;
      const start = ctx.currentTime + 0.005;
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          this.onStatus('効果音を読み込めませんでした。');
          continue;
        }
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = result.value;
        // 消去SEだけを変調する。T-spin・全消しなどのボイスはそのまま再生する。
        source.playbackRate.setValueAtTime(clips[index].endsWith('_a') ? effectRate : 1, start);
        // ボイスと同時に鳴るときも、それぞれの輪郭と音量の余裕を保つ。
        const rotation = ROTATION_SOUNDS.find((sound) => sound.clip === clips[index]);
        gain.gain.setValueAtTime(
          rotation?.gain ?? (clips[index].endsWith('_a') ? 0.85 : 0.9),
          start,
        );
        source.connect(gain);
        gain.connect(this.seGain!);
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
        };
        source.start(start);
      }
    });
  }

  play(event: GameEvent): void {
    if (!this.enabled || !this.settings.seVolume || this.context?.state !== 'running') return;
    const clips = eventSounds(event);
    if (clips.length) {
      this.playClips(clips, event.type === 'clear' ? clearPlaybackRate(event.ren) : 1);
      return;
    }
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value =
      event.type === 'clear'
        ? 360 + event.amount * 120
        : event.type === 'garbage'
          ? 110
          : event.type === 'roundEnd'
            ? 660
            : 170;
    oscillator.type = event.type === 'lock' ? 'sine' : 'triangle';
    const duration = event.type === 'lock' ? 0.045 : 0.16;
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(this.seGain!);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
