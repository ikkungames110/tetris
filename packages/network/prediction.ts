import { cancelGarbage } from '../core/attack';
import { stepPlayer } from '../core/engine';
import { Button, RULES, type Input, type Player, type ClearEffect } from '../core/types';
import type { PublicPlayer } from '../protocol/online';

// Predict only the local player's published piece queue. Never invent future
// pieces, garbage holes or a match result. Acknowledged inputs aren't replayed.
export class PlayerPrediction {
  player: Player | null = null;
  tick = 0;
  clearEffect: ClearEffect | undefined;
  private pending: { seq: number; input: Input }[] = [];
  private blocked = false;
  private attackReduction = 0;

  reset(): void {
    this.player = null;
    this.clearEffect = undefined;
    this.tick = 0;
    this.pending = [];
    this.blocked = false;
    this.attackReduction = 0;
  }

  reconcile(player: PublicPlayer, tick: number, ack: number, attackReduction = 0): void {
    this.attackReduction = attackReduction;
    this.pending = this.pending.filter((frame) => frame.seq > ack);
    this.player = { ...structuredClone(player), bag: { rng: 0, remaining: [] }, garbageRng: 0 };
    this.tick = tick;
    this.clearEffect = player.clearEffect;
    this.blocked = false;
    for (const frame of this.pending) this.step(frame.input);
  }

  input(seq: number, input: Input): void {
    if (!this.player) return;
    if (this.pending.length >= 120) {
      this.blocked = true;
      return;
    }
    this.pending.push({ seq, input: { ...input } });
    this.step(input);
  }

  private step(input: Input): void {
    const player = this.player;
    if (!player || this.blocked) return;
    const piecesNeeded =
      Number(!player.active) +
      Number(!!(input.pressed & Button.hold) && !player.holdUsed && !player.hold);
    if (player.next.length < piecesNeeded) {
      this.blocked = true;
      return;
    }
    const result = stepPlayer(
      player,
      input,
      ++this.tick,
      RULES,
      () => null,
      (_player, effect) => {
        this.clearEffect = effect;
      },
    );
    if (!result) return;
    player.stats.sent += Math.max(0, cancelGarbage(player, result.attack) - this.attackReduction);
    if (result.lines === 0 && player.incoming.some((g) => g.eligibleTick <= this.tick)) {
      // The lock is visible immediately; subsequent simulation waits for the
      // host's authoritative garbage holes instead of using a fake random seed.
      this.blocked = true;
    }
  }
}
