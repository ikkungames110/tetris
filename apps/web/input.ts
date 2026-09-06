import { Button, NO_INPUT, type Input } from '../../packages/core/types';
import {
  defaultBindings,
  profileKey,
  readPad,
  validBindings,
  type Bindings,
  type Pad,
} from './gamepad';

export type Device = 'keyboard1' | `pad:${number}`;
export const KEYBOARDS: Record<string, number>[] = [
  {
    ArrowLeft: Button.left,
    ArrowRight: Button.right,
    ArrowDown: Button.soft,
    ArrowUp: Button.hard,
    Space: Button.hard,
    KeyZ: Button.ccw,
    KeyX: Button.cw,
    KeyC: Button.hold,
    ShiftRight: Button.hold,
    Escape: Button.pause,
  },
];

export class InputManager {
  assignments: [Device] = ['keyboard1'];
  private connectedPads = new Set<string>();
  sticks = false;
  pads: Pad[] = [];
  apiError = '';
  private keys = new Set<string>();
  private keyPresses = new Set<string>();
  private previous: [number, number] = [0, 0];
  private pending: [Input, Input] = [{ ...NO_INPUT }, { ...NO_INPUT }];
  private suppressed: [number, number] = [0, 0];
  private profiles: Record<string, Bindings> = {};
  enabled = false;

  constructor() {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('stack-gamepads-v1') ?? '{}');
      if (saved && typeof saved === 'object')
        for (const [key, value] of Object.entries(saved)) {
          if (validBindings(value)) this.profiles[key] = value;
        }
      this.sticks = localStorage.getItem('stack-stick') === 'true';
    } catch {
      /* A missing/corrupt/private storage must not prevent play. */
    }
    window.addEventListener('keydown', (event) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (!this.keys.has(event.code) && !event.repeat) this.keyPresses.add(event.code);
      this.keys.add(event.code);
      if (this.enabled && KEYBOARDS.some((keys) => event.code in keys)) event.preventDefault();
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.reset());
  }

  bindings(pad: Pad): Bindings {
    const saved = this.profiles[profileKey(pad)];
    if (saved && Object.values(saved).every((list) => list.length > 0)) return saved;
    const defaults = defaultBindings(pad);
    if (!saved) return defaults;
    // Older versions saved empty slots for unmapped pads. Fill those slots
    // while retaining any buttons the player already customized.
    for (const action of Object.keys(defaults) as (keyof Bindings)[])
      if (saved[action].length) defaults[action] = saved[action];
    return defaults;
  }

  saveBindings(pad: Pad, bindings: Bindings): void {
    this.profiles[profileKey(pad)] = structuredClone(bindings);
    try {
      localStorage.setItem('stack-gamepads-v1', JSON.stringify(this.profiles));
    } catch {
      /* Session-only settings. */
    }
  }

  selectedPad(player: number): Pad | undefined {
    const device = this.assignments[player];
    return device.startsWith('pad:')
      ? this.pads.find((pad) => pad.index === Number(device.slice(4)))
      : undefined;
  }

  poll(): void {
    try {
      if (typeof navigator.getGamepads !== 'function') {
        this.apiError = 'このブラウザーではゲームパッドを利用できません。';
        this.pads = [];
      } else {
        this.pads = Array.from(navigator.getGamepads()).filter(
          (pad): pad is Gamepad => !!pad?.connected,
        );
        this.apiError = '';
      }
    } catch {
      this.pads = [];
      this.apiError = 'ゲームパッドを取得できません。localhost または HTTPS で開いてください。';
    }
    const keys = new Set(this.pads.map((pad) => `${pad.index}:${pad.id}`));
    const added = this.pads.find((pad) => !this.connectedPads.has(`${pad.index}:${pad.id}`));
    if (added && !this.selectedPad(0)) {
      this.assignments[0] = `pad:${added.index}`;
      const held = readPad(added, this.bindings(added), this.sticks);
      this.previous[0] = held;
      this.suppressed[0] = held;
      this.pending[0] = { ...NO_INPUT };
      this.keyPresses.clear();
    }
    this.connectedPads = keys;
    for (let player = 0; player < 1; player++) {
      const device = this.assignments[player];
      let held = 0;
      let keyEdges = 0;
      if (device.startsWith('keyboard')) {
        const keyboard = KEYBOARDS[0];
        for (const key of this.keys) held |= keyboard[key] ?? 0;
        for (const key of this.keyPresses) keyEdges |= keyboard[key] ?? 0;
      } else {
        const pad = this.selectedPad(player);
        if (pad) held = readPad(pad, this.bindings(pad), this.sticks, this.previous[player]);
      }
      this.suppressed[player] &= held;
      const pressed = ((held & ~this.previous[player]) | keyEdges) & ~this.suppressed[player];
      this.previous[player] = held;
      this.pending[player].held = held & ~this.suppressed[player];
      this.pending[player].pressed |= pressed;
    }
    // Escape remains available when a gamepad is selected.
    if (this.keyPresses.has('Escape')) this.pending[0].pressed |= Button.pause;
    this.keyPresses.clear();
  }

  consume(): [Input, Input] {
    const result: [Input, Input] = [{ ...this.pending[0] }, { ...this.pending[1] }];
    this.pending[0].pressed = 0;
    this.pending[1].pressed = 0;
    return result;
  }

  // On pause/start/settings, require held controls to be released before acting again.
  suppressHeld(): void {
    this.suppressed = [...this.previous];
    for (let i = 0; i < 1; i++) {
      const device = this.assignments[i];
      if (device.startsWith('keyboard')) {
        const keyboard = KEYBOARDS[0];
        for (const key of this.keys) this.suppressed[i] |= keyboard[key] ?? 0;
      }
    }
    this.pending = [{ ...NO_INPUT }, { ...NO_INPUT }];
    this.keyPresses.clear();
  }

  reset(): void {
    this.keys.clear();
    this.keyPresses.clear();
    this.pending = [{ ...NO_INPUT }, { ...NO_INPUT }];
    this.suppressed = [...this.previous];
  }
}
