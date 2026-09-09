export const GARBAGE_RISE_MS = 320;

// The authoritative board already includes the garbage. Move its cells from
// their previous height to that final position before presenting the result.
export class GarbageRise {
  private received: number | null = null;
  private startedAt = 0;
  private lines = 0;

  offset(received: number, now: number, reducedMotion = false): number {
    if (this.received !== null && received > this.received) {
      this.lines = Math.min(20, received - this.received);
      this.startedAt = now;
    }
    this.received = received;
    if (reducedMotion) return 0;
    const progress = Math.min(1, Math.max(0, (now - this.startedAt) / GARBAGE_RISE_MS));
    return this.lines * (1 - progress) ** 3;
  }

  reset(): void {
    this.received = null;
    this.lines = 0;
  }
}
