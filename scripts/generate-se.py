#!/usr/bin/env python3
"""Synthesize 18 SE candidates and a deluxe Perfect clear using Python + FFmpeg."""

import argparse
import array
import json
import math
from pathlib import Path
import random
import subprocess
import tempfile
import wave

RATE = 44100
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'se-preview'
TAU = 2 * math.pi
KINDS = [
    ('lock', 'ミノ設置', 0.14, -15),
    ('rotate', '回転', 0.11, -17),
    ('rotate_tspin', '回転（T-spin）', 0.23, -15),
    ('clear', 'ライン消去', 0.36, -12),
    ('clear_tspin', 'ライン消去（T-spin）', 0.58, -10),
    ('clear_four', 'ライン消去（4LINE）', 0.75, -9),
]
PALETTES = [('a', 'Wood', 0.94), ('b', 'Glass', 1.08), ('c', 'Soft synth', 1.0)]


def note(bus, palette, frequency, start, duration, amplitude, pan=0, glide=0, decay=5.5):
    """Short, band-limited pitched transient with smooth attack/release."""
    phase = 0.0
    count = int(duration * RATE)
    offset = int(start * RATE)
    left = math.sqrt((1 - pan) / 2)
    right = math.sqrt((1 + pan) / 2)
    for i in range(min(count, len(bus[0]) - offset)):
        t = i / RATE
        progress = i / count
        phase += TAU * frequency * (1 + glide * math.exp(-t / 0.025)) / RATE
        attack = 1 - math.exp(-t / 0.0025)
        release = min(1, (1 - progress) * duration / 0.025)
        envelope = attack * math.exp(-progress * decay) * release * release
        if palette == 'a':
            value = (math.sin(phase)
                     + 0.26 * math.sin(phase * 2) * math.exp(-t / 0.025)
                     + 0.11 * math.sin(phase * 3) * math.exp(-t / 0.014))
        elif palette == 'b':
            value = (math.sin(phase + 0.65 * math.sin(phase * 2) * math.exp(-t / 0.038))
                     + 0.13 * math.sin(phase * 3) * math.exp(-t / 0.05))
        else:
            value = (math.sin(phase)
                     + 0.17 * math.sin(phase * 3) * math.exp(-t / 0.055)
                     + 0.045 * math.sin(phase * 5) * math.exp(-t / 0.022))
        value *= amplitude * envelope
        bus[0][offset + i] += value * left
        bus[1][offset + i] += value * right


def synthesize(kind, palette, duration, peak_db, seed):
    bus = [[0.0] * int(duration * RATE) for _ in range(2)]

    def add(frequency, start=0, length=None, amplitude=1, pan=0, glide=0, decay=5.5):
        note(bus, palette, frequency, start, length or (duration - start), amplitude, pan, glide, decay)

    if kind == 'lock':
        add(196, glide=0.28)
        add(392, length=0.045, amplitude=0.2)
        # Quiet, low-pass noise gives the wooden contact a tactile edge.
        rng = random.Random(seed)
        filtered = 0.0
        for i in range(int(0.028 * RATE)):
            t = i / RATE
            filtered += 0.12 * (rng.uniform(-1, 1) - filtered)
            value = filtered * 0.2 * (1 - math.exp(-t / 0.0015)) * math.exp(-t / 0.004)
            for channel in bus:
                channel[i] += value
    elif kind == 'rotate':
        add(587.33, glide=-0.17)
    elif kind == 'rotate_tspin':
        add(587.33, length=0.12, amplitude=0.65, glide=-0.18)
        add(880, start=0.048, amplitude=0.85, glide=-0.07)
        add(440, start=0.065, amplitude=0.32)
    elif kind == 'clear':
        add(523.25, length=duration * 0.7, amplitude=0.8, pan=-0.12)
        add(783.99, start=0.065, pan=0.12)
        add(261.63, amplitude=0.24)
    elif kind == 'clear_tspin':
        add(880, length=0.18, amplitude=0.55, pan=-0.18, glide=0.14)
        add(659.25, start=0.038, length=0.16, amplitude=0.5, pan=0.18)
        for frequency, pan, amp in [(440, -0.2, 0.8), (659.25, 0, 0.6), (987.77, 0.2, 0.48)]:
            add(frequency, start=0.10, amplitude=amp, pan=pan, glide=-0.025)
    elif kind == 'perfect_clear':
        # A wooden rising fanfare opens into a wide, sustained C major add6 chord.
        add(130.81, length=1.35, amplitude=0.6, decay=3.2)
        for i, frequency in enumerate([261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5, 1567.98]):
            add(frequency, start=i * 0.048, length=0.6,
                amplitude=0.65 - i * 0.045, pan=(i - 3.5) * 0.13)
        for frequency, pan, amp in [(261.63, -0.2, 0.62), (392, 0.2, 0.44),
                                    (523.25, -0.4, 0.34), (659.25, 0.4, 0.3),
                                    (880, 0, 0.18)]:
            add(frequency, start=0.39, length=1.41, amplitude=amp, pan=pan, decay=3.4)
        for i, frequency in enumerate([1046.5, 1567.98, 2093, 1567.98]):
            note(bus, 'b', frequency, 0.46 + i * 0.10, 1.0 - i * 0.10,
                 0.11 - i * 0.016, (-1 if i % 2 else 1) * 0.6, decay=3.6)
    else:
        for i, frequency in enumerate([392, 523.25, 659.25, 783.99]):
            add(frequency, start=i * 0.05, length=duration * 0.57,
                amplitude=0.65 + i * 0.055, pan=(i - 1.5) * 0.14)
        for frequency, pan, amp in [(261.63, 0, 0.7), (523.25, -0.25, 0.48), (1046.5, 0.25, 0.28)]:
            add(frequency, start=0.205, amplitude=amp, pan=pan)

    # Sparse, quiet stereo reflections only on clears; no long tail on frequent inputs.
    if kind.startswith('clear') or kind == 'perfect_clear':
        dry = [channel[:] for channel in bus]
        reflections = ([(0.061, 0.12), (0.127, 0.075), (0.193, 0.045)]
                       if kind == 'perfect_clear' else [(0.043, 0.10), (0.079, 0.045)])
        for delay, level in reflections:
            shift = int(delay * RATE)
            for channel in range(2):
                for i in range(shift, len(bus[channel])):
                    bus[channel][i] += dry[1 - channel][i - shift] * level
    for channel in bus:
        for i in range(len(channel)):
            channel[i] *= min(1, i / (RATE * 0.001), (len(channel) - 1 - i) / (RATE * 0.02))
    peak = max(abs(value) for channel in bus for value in channel)
    scale = 10 ** (peak_db / 20) / peak
    samples = array.array('h')
    energy = 0.0
    for left, right in zip(*bus):
        for value in (left * scale, right * scale):
            energy += value * value
            samples.append(round(value * 32767))
    import sys
    if sys.byteorder != 'little':
        samples.byteswap()
    return samples.tobytes(), 20 * math.log10(math.sqrt(energy / len(samples)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--perfect-only', action='store_true', help='Keep the 18 existing candidates unchanged')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = ([item for item in json.loads((OUT / 'manifest.json').read_text())
                 if item['kind'] != 'perfect_clear'] if args.perfect_only else [])
    with tempfile.TemporaryDirectory(prefix='tetcla-se-') as temporary:
        wav = Path(temporary) / 'source.wav'
        for p, (palette, title, length_scale) in enumerate([] if args.perfect_only else PALETTES):
            for k, (kind, label, base_length, peak_db) in enumerate(KINDS):
                duration = round(base_length * length_scale, 3)
                pcm, rms_db = synthesize(kind, palette, duration, peak_db, 4100 + p * 10 + k)
                with wave.open(str(wav), 'wb') as output:
                    output.setnchannels(2)
                    output.setsampwidth(2)
                    output.setframerate(RATE)
                    output.writeframes(pcm)
                filename = f'{kind}_{palette}.mp3'
                subprocess.run([
                    args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                    '-codec:a', 'libmp3lame', '-b:a', '192k', '-ar', str(RATE),
                    '-metadata', f'title=Tetcla {label} / {title}',
                    '-metadata', 'artist=Tetcla original synthesis', str(OUT / filename),
                ], check=True)
                manifest.append(dict(file=filename, kind=kind, label=label, pattern=palette,
                                     title=title, duration=duration, peakDb=peak_db,
                                     rmsDb=round(rms_db, 2)))
                print(f'{filename}: {duration:.3f}s, peak {peak_db} dBFS, RMS {rms_db:.1f} dBFS')
        pcm, rms_db = synthesize('perfect_clear', 'a', 1.8, -9, 4200)
        with wave.open(str(wav), 'wb') as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes(pcm)
        subprocess.run([
            args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
            '-codec:a', 'libmp3lame', '-b:a', '192k', '-ar', str(RATE),
            '-metadata', 'title=Tetcla Perfect clear / Deluxe Wood',
            '-metadata', 'artist=Tetcla original synthesis', str(OUT / 'perfect_clear_a.mp3'),
        ], check=True)
        manifest.append(dict(file='perfect_clear_a.mp3', kind='perfect_clear', label='Perfect clear',
                             pattern='special', title='Deluxe Wood', duration=1.8,
                             peakDb=-9, rmsDb=round(rms_db, 2)))
        print(f'perfect_clear_a.mp3: 1.800s, peak -9 dBFS, RMS {rms_db:.1f} dBFS')
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
