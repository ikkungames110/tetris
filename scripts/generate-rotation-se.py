#!/usr/bin/env python3
"""Ten rotation sounds with different synthesis methods; Python stdlib + FFmpeg."""
import argparse
import array
import json
import math
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import wave

RATE = 44100
TAU = math.tau
OUT = Path(__file__).resolve().parent.parent / 'public' / 'rotation-preview'
SOUNDS = [
    ('01_wood_beads', '木玉ころころ', 'コロッ', '木・打楽器', 0.19,
     '小さな木玉が2〜3回、軽く触れる音。転がる手触りを第一候補に。', '木質の非整数倍音＋小さな3打'),
    ('02_water_drops', '水滴ポロン', 'ポロン', '水・透明', 0.22,
     '丸い水滴が大小ふたつ。澄んだ音で、木玉よりみずみずしく。', '固定音程のサイン波2滴＋薄い高域'),
    ('03_micro_bubbles', '小さな泡', 'プルル', '泡・有機的', 0.18,
     '低めの泡が細かく弾む音。音程を滑らせず、音量の粒で柔らかく。', '低いサイン波の3粒＋振幅変調'),
    ('04_analog_pluck', 'アナログ・プラック', 'ポッ', 'シンセ・アナログ', 0.16,
     'フィルターを通した丸いシンセ。軽さの中に、少しだけ芯のある電子音。', 'ノコギリ波の減算合成・共振なしのローパス'),
    ('05_fm_keys', 'FMエレピ', 'トゥン', 'シンセ・FM', 0.23,
     'エレピを小さくつまんだような音。柔らかな金属感と短い余韻。', '固定キャリアのFM＋減衰する変調指数'),
    ('06_triangle_chip', 'まるいチップ音', 'ピロッ', 'シンセ・レトロ', 0.15,
     '角を落とした三角波の二音。短く軽い、レトロゲーム寄りの音。', '帯域制限した三角波の離散的な二音'),
    ('07_nylon_string', 'ナイロン・プルン', 'プルン', '弦・撥弦', 0.25,
     '小さなナイロン弦を指ではじく感触。打楽器とは違う、しなやかな響き。', 'Karplus–Strongの減衰弦モデル'),
    ('08_soft_shaker', '小粒シェイカー', 'サラコロ', 'ノイズ・打楽器', 0.14,
     '柔らかな粒が流れる音。音程をほとんど持たず、BGMに溶け込む方向。', '帯域を絞ったノイズの4粒＋弱い胴鳴り'),
    ('09_ceramic', '陶器トロン', 'トロン', '陶器・共鳴', 0.24,
     '薄い陶器をそっと触れる音。木より澄んで、ベルより落ち着いた響き。', '独立して減衰する陶器風の非整数モード'),
    ('10_cloud_chord', 'クラウド・シンセ', 'ポワッ', 'シンセ・和音', 0.26,
     '小さな和音がふわっと開く音。打撃感を抑えた、空気のようなシンセ。', 'サイン波のadd9和音＋微小デチューン・柔らかいゲート'),
]


def envelope(t, length, attack=0.003, decay=4.5):
    if t < 0 or t >= length:
        return 0
    return (1 - math.exp(-t / attack)) * math.exp(-decay * t / length) * min(1, (length - t) / 0.018) ** 2


def synthesize(index, duration):
    result = [0.0] * round(duration * RATE)
    rng = random.Random(91800 + index)

    def tone(freq, start, length, amp=1, partials=((1, 1),), decay=4.5, attack=0.003):
        for j in range(min(round(length * RATE), len(result) - round(start * RATE))):
            t = j / RATE
            value = sum(level * math.sin(TAU * freq * ratio * t) * math.exp(-t * max(0, ratio - 1) * 12)
                        for ratio, level in partials)
            result[round(start * RATE) + j] += amp * envelope(t, length, attack, decay) * value

    if index == 0:
        for freq, start, amp in [(370, 0, 1), (315, 0.043, 0.46), (345, 0.079, 0.18)]:
            tone(freq, start, 0.1, amp, ((1, 1), (2.76, 0.35), (5.4, 0.045)))
    elif index == 1:
        tone(660, 0, 0.15, partials=((1, 1), (2, 0.06)), decay=3.7)
        tone(440, 0.053, 0.16, 0.48, decay=3.9)
    elif index == 2:
        for freq, start, amp in [(245, 0, 1), (290, 0.036, 0.52), (230, 0.066, 0.24)]:
            tone(freq, start, 0.09, amp, ((1, 1), (2, 0.11)))
        for i in range(len(result)):
            result[i] *= 0.85 + 0.15 * math.cos(TAU * 43 * i / RATE)
    elif index == 3:
        low1 = low2 = 0.0
        for i in range(len(result)):
            t = i / RATE
            saw = sum(math.sin(TAU * 220 * harmonic * t) / harmonic for harmonic in range(1, 17))
            cutoff = 500 + 1800 * math.exp(-t / 0.014)
            alpha = 1 - math.exp(-TAU * cutoff / RATE)
            low1 += alpha * (saw - low1)
            low2 += alpha * (low1 - low2)
            result[i] = low2 * envelope(t, duration, 0.003, 5)
    elif index == 4:
        for i in range(len(result)):
            t = i / RATE
            phase = TAU * 392 * t
            result[i] = (math.sin(phase + 1.4 * math.exp(-t / 0.026) * math.sin(phase * 3))
                         + 0.14 * math.sin(phase * 2)) * envelope(t, duration, 0.004, 4.3)
    elif index == 5:
        partials = tuple((h, (-1) ** ((h - 1) // 2) / (h * h)) for h in [1, 3, 5, 7])
        tone(784, 0, 0.065, 0.7, partials, decay=1.6)
        tone(523.25, 0.06, 0.085, 0.6, partials, decay=2.3)
    elif index == 6:
        delay = round(RATE / 330)
        string = [rng.uniform(-1, 1) for _ in range(delay)]
        # Smooth the excitation before circulating it: no sharp guitar pick click.
        for _ in range(6):
            string = [(value + string[(i + 1) % delay]) * 0.5 for i, value in enumerate(string)]
        for i in range(len(result)):
            pos = i % delay
            value = string[pos]
            string[pos] = 0.994 * (value + string[(pos + 1) % delay]) * 0.5
            result[i] = value * envelope(i / RATE, duration, 0.004, 1.3)
    elif index == 7:
        low = high = 0.0
        for i in range(len(result)):
            t = i / RATE
            noise = rng.uniform(-1, 1)
            low += 0.15 * (noise - low)
            high += 0.035 * (noise - high)
            grain = sum(amp * envelope(t - start, 0.042, 0.002, 3.2)
                        for start, amp in [(0, 1), (0.025, 0.7), (0.05, 0.4), (0.082, 0.16)])
            result[i] = (low - high) * grain
        tone(280, 0, 0.07, 0.065)
    elif index == 8:
        tone(510, 0, duration, partials=((1, 1), (2.32, 0.23), (3.87, 0.075)), decay=3.3, attack=0.005)
        tone(510, 0.058, 0.12, 0.12, partials=((1, 1), (2.32, 0.1)))
    elif index == 9:
        for frequency, amp in [(261.63, 0.55), (392, 0.23), (587.33, 0.19)]:
            for detune in [0.997, 1.003]:
                tone(frequency * detune, 0, duration, amp, decay=3.0, attack=0.008)

    # Remove DC, smooth endpoints and match energy per press over a fixed window.
    mean = sum(result) / len(result)
    for i in range(len(result)):
        result[i] = (result[i] - mean) * min(1, i / (RATE * 0.002), (len(result) - i - 1) / (RATE * 0.015))
    energy_rms = math.sqrt(sum(x * x for x in result) / (RATE * 0.22))
    scale = min(10 ** (-29 / 20) / energy_rms, 10 ** (-13 / 20) / max(map(abs, result)))
    return [value * scale for value in result]


def encode(ffmpeg, samples, destination, title):
    pcm = array.array('h', (round(value * 32767) for value in samples for _ in range(2)))
    if sys.byteorder != 'little':
        pcm.byteswap()
    with tempfile.TemporaryDirectory(prefix='tetcla-rotate-') as temporary:
        wav = Path(temporary) / 'source.wav'
        with wave.open(str(wav), 'wb') as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes(pcm.tobytes())
        subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(wav), '-codec:a', 'libmp3lame',
                        '-b:a', '192k', '-metadata', f'title=Tetcla rotation / {title}',
                        '-metadata', 'artist=Tetcla original synthesis', str(destination)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for index, (id_, title, feel, family, duration, description, method) in enumerate(SOUNDS):
        samples = synthesize(index, duration)
        encode(args.ffmpeg, samples, OUT / f'{id_}.mp3', title)
        # A pre-rendered rhythm makes rapid presses comparable, including on mobile.
        times = [0, 0.34, 0.68, 1.02, 1.65, 1.79, 1.93, 2.07, 2.21, 2.35]
        demo = [0.0] * round(2.8 * RATE)
        for time in times:
            start = round(time * RATE)
            for i, sample in enumerate(samples):
                demo[start + i] += sample
        encode(args.ffmpeg, demo, OUT / f'{id_}_repeat.mp3', f'{title} / 連続回転')
        manifest.append(dict(id=id_, title=title, feel=feel, family=family, duration=duration,
                             description=description, method=method, file=f'{id_}.mp3',
                             repeatFile=f'{id_}_repeat.mp3',
                             peakDb=round(20 * math.log10(max(map(abs, samples))), 2),
                             referenceRmsDb=round(20 * math.log10(math.sqrt(sum(x*x for x in samples)/(RATE*0.22))), 2)))
        print(f'{id_}: {duration:.2f}s, peak {manifest[-1]["peakDb"]} dBFS, reference RMS {manifest[-1]["referenceRmsDb"]} dBFS')
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
