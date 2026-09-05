export class Sound {
  enabled = false;
  private context: AudioContext | null = null;

  unlock(): void {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch {
      /* Audio is optional. */
    }
  }

  play(type: 'lock' | 'clear' | 'garbage' | 'roundEnd', amount: number): void {
    if (!this.enabled || this.context?.state !== 'running') return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const frequency =
      type === 'clear'
        ? 360 + amount * 120
        : type === 'garbage'
          ? 110
          : type === 'roundEnd'
            ? 660
            : 170;
    oscillator.type = type === 'lock' ? 'sine' : 'triangle';
    oscillator.frequency.value = frequency;
    const duration = type === 'lock' ? 0.045 : 0.16;
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
