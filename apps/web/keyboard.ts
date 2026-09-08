import { Button, type Action } from '../../packages/core/types';

export type KeyboardBindings = Record<Action, string[]>;

export function defaultKeyboardBindings(): KeyboardBindings {
  return {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    soft: ['ArrowDown'],
    hard: ['Space', 'ArrowUp'],
    ccw: ['KeyZ'],
    cw: ['KeyX'],
    hold: ['ShiftLeft'],
    pause: ['Escape'],
  };
}

export function keyLabel(code: string): string {
  const labels: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowDown: '↓',
    ArrowUp: '↑',
    ShiftLeft: '左Shift',
    ShiftRight: '右Shift',
    ControlLeft: '左Ctrl',
    ControlRight: '右Ctrl',
    AltLeft: '左Alt',
    AltRight: '右Alt',
    MetaLeft: '左Meta',
    MetaRight: '右Meta',
    Escape: 'Esc',
  };
  return labels[code] ?? code.replace(/^(Key|Digit)/, '');
}

export function keyboardMap(bindings: KeyboardBindings): Record<string, number> {
  const result: Record<string, number> = Object.create(null);
  for (const action of Object.keys(Button) as Action[])
    for (const code of bindings[action]) result[code] = Button[action];
  return result;
}

export function validKeyboardBindings(value: unknown): value is KeyboardBindings {
  if (!value || typeof value !== 'object') return false;
  const seen = new Set<string>();
  return (Object.keys(Button) as Action[]).every((action) => {
    const codes = (value as Record<string, unknown>)[action];
    return (
      Array.isArray(codes) &&
      codes.length > 0 &&
      codes.length <= 4 &&
      codes.every((code) => {
        if (
          typeof code !== 'string' ||
          !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(code) ||
          code === 'Unidentified' ||
          seen.has(code)
        )
          return false;
        seen.add(code);
        return true;
      })
    );
  });
}
