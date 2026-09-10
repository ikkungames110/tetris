import { Button, type Action } from '../../packages/core/types';

export interface Pad {
  id: string;
  index: number;
  mapping: string;
  connected: boolean;
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}
export type Binding =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; sign: -1 | 1 }
  | { kind: 'hat'; index: number; value: number };
export type Bindings = Record<Action, Binding[]>;
export const ACTION_LABELS: Record<Action, string> = {
  left: '左移動',
  right: '右移動',
  soft: 'ソフトドロップ',
  hard: 'ハードドロップ',
  ccw: '左回転',
  cw: '右回転',
  hold: 'HOLD',
  pause: '一時停止 / 開始',
};
const buttons = (...indices: number[]): Binding[] =>
  indices.map((index) => ({ kind: 'button', index }));
export function standardBindings(): Bindings {
  // W3C standard layout: DS4 ×=0, ○=1, □=2, △=3, L1=4, R1=5, OPTIONS=9.
  return {
    left: buttons(14),
    right: buttons(15),
    soft: buttons(13),
    hard: buttons(12, 3),
    ccw: buttons(0, 2),
    cw: buttons(1),
    hold: buttons(4, 5),
    pause: buttons(9),
  };
}
export function defaultBindings(pad: Pad): Bindings {
  const bindings = standardBindings();
  if (pad.mapping === 'standard') return bindings;
  // Common USB pads without a browser mapping still get usable defaults.
  // Their axes provide directions; individual bindings remain editable.
  if (pad.buttons.length < 16 && pad.axes.length >= 2) {
    bindings.left = [{ kind: 'axis', index: 0, sign: -1 }];
    bindings.right = [{ kind: 'axis', index: 0, sign: 1 }];
    bindings.soft = [{ kind: 'axis', index: 1, sign: 1 }];
    bindings.hard = buttons(3);
  }
  if (pad.buttons.length < 10) bindings.pause = buttons(7);
  return bindings;
}

export function padName(pad: Pad): string {
  if (/dualsense|054c.*0ce6/i.test(pad.id)) return 'DualSense';
  if (isDualShock4(pad)) return 'DualShock 4';
  if (/dualshock|054c|sony/i.test(pad.id)) return 'PlayStation';
  if (/xbox|xinput|045e/i.test(pad.id)) return 'Xbox';
  if (/switch|pro controller|joy-con|057e/i.test(pad.id)) return 'Nintendo';
  return 'ゲームパッド';
}

export function emptyBindings(): Bindings {
  return { left: [], right: [], soft: [], hard: [], ccw: [], cw: [], hold: [], pause: [] };
}
export function profileKey(pad: Pad): string {
  return `${pad.id}:${pad.mapping}`;
}

export function readPad(
  pad: Pad | undefined,
  bindings: Bindings,
  sticks: boolean,
  previous = 0,
): number {
  if (!pad?.connected) return 0;
  let mask = 0;
  for (const action of Object.keys(Button) as Action[]) {
    const threshold = previous & Button[action] ? 0.4 : 0.6;
    if (
      bindings[action].some((binding) => {
        if (binding.kind === 'button')
          return (
            (pad.buttons[binding.index]?.value ?? 0) >= 0.5 || !!pad.buttons[binding.index]?.pressed
          );
        const value = pad.axes[binding.index] ?? 0;
        return binding.kind === 'axis'
          ? value * binding.sign >= threshold
          : Math.abs(value - binding.value) < 0.06;
      })
    )
      mask |= Button[action];
  }
  if (sticks) {
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    if (x <= -(previous & Button.left ? 0.4 : 0.6)) mask |= Button.left;
    if (x >= (previous & Button.right ? 0.4 : 0.6)) mask |= Button.right;
    if (y >= (previous & Button.soft ? 0.4 : 0.6)) mask |= Button.soft;
    // Stick up deliberately does not hard-drop: small diagonal motions must not lock a piece.
  }
  return mask;
}

export function captureBinding(before: Pad, current: Pad): Binding | null {
  for (let i = 0; i < current.buttons.length; i++) {
    if (current.buttons[i].value >= 0.5 && (before.buttons[i]?.value ?? 0) < 0.5)
      return { kind: 'button', index: i };
  }
  for (let i = 0; i < current.axes.length; i++) {
    const previous = before.axes[i] ?? 0;
    const value = current.axes[i];
    if (Math.abs(value - previous) < 0.3) continue;
    // Raw HID hats often report their neutral position outside [-1,1].
    if (Math.abs(previous) > 1 && Math.abs(value) <= 1) return { kind: 'hat', index: i, value };
    if (Math.abs(previous) < 0.4 && Math.abs(value) > 0.7 && Math.abs(value) <= 1)
      return { kind: 'axis', index: i, sign: value > 0 ? 1 : -1 };
  }
  return null;
}

function isDualShock4(pad: Pad): boolean {
  return /dualshock\s*4|054c.*(?:05c4|09cc|0ba0)/i.test(pad.id);
}

const DS4_BUTTON_LABELS = [
  '×',
  '〇',
  '□',
  '△',
  'L1',
  'R1',
  'L2',
  'R2',
  'SHARE',
  'OPTIONS',
  'L3',
  'R3',
  '↑',
  '↓',
  '←',
  '→',
];

export function buttonLabel(index: number, pad?: Pad): string {
  return (pad && isDualShock4(pad) && DS4_BUTTON_LABELS[index]) || `B${index}`;
}

export function bindingLabel(binding: Binding, pad?: Pad): string {
  return binding.kind === 'button'
    ? buttonLabel(binding.index, pad)
    : binding.kind === 'axis'
      ? `軸${binding.index}${binding.sign > 0 ? '+' : '−'}`
      : `十字軸${binding.index} (${binding.value.toFixed(2)})`;
}

export function validBindings(value: unknown): value is Bindings {
  if (!value || typeof value !== 'object') return false;
  return (Object.keys(Button) as Action[]).every((action) => {
    const list = (value as Record<string, unknown>)[action];
    return (
      Array.isArray(list) &&
      list.length <= 4 &&
      list.every(
        (b) =>
          b &&
          Number.isInteger(b.index) &&
          b.index >= 0 &&
          b.index < 64 &&
          (b.kind === 'button' ||
            (b.kind === 'axis' && (b.sign === 1 || b.sign === -1)) ||
            (b.kind === 'hat' && Number.isFinite(b.value) && Math.abs(b.value) <= 1)),
      )
    );
  });
}
