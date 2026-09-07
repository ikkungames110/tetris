import { expect, it } from 'vitest';
import { InitialInput } from '../../apps/web/initial-input';
import { Button, NO_INPUT } from '../../packages/core/types';

it('カウント中に離した回転・移動も、開始時に一度だけ渡す', () => {
  const initial = new InitialInput();
  initial.capture({ held: Button.left | Button.cw, pressed: Button.left | Button.cw });
  initial.capture(NO_INPUT);
  expect(initial.take(NO_INPUT)).toEqual({ held: 0, pressed: Button.left | Button.cw });
  expect(initial.take(NO_INPUT)).toEqual(NO_INPUT);
});

it('反対方向への変更は最後の入力を優先し、同時押しは両方渡す', () => {
  const initial = new InitialInput();
  initial.capture({ held: 0, pressed: Button.left | Button.cw });
  initial.capture({ held: 0, pressed: Button.right | Button.ccw });
  expect(initial.take(NO_INPUT).pressed).toBe(Button.right | Button.ccw);
  initial.capture({ held: 0, pressed: Button.left | Button.right });
  expect(initial.take(NO_INPUT).pressed).toBe(Button.left | Button.right);
});

it('HOLD後も予約した回転とドロップを失わず、押し続けても再実行しない', () => {
  const initial = new InitialInput();
  const held = Button.hold | Button.cw | Button.hard;
  initial.capture({ held, pressed: held });
  expect(initial.take({ held, pressed: 0 })).toEqual({ held, pressed: Button.hold });
  expect(initial.take({ held, pressed: 0 })).toEqual({ held, pressed: Button.cw | Button.hard });
  expect(initial.take({ held, pressed: 0 })).toEqual({ held, pressed: 0 });
});

it('一時停止・設定・再開始で予約を消し、通常の入力はそのまま通す', () => {
  const initial = new InitialInput();
  initial.capture({ held: 0, pressed: Button.hard | Button.pause });
  initial.reset();
  expect(initial.pending).toBe(false);
  expect(initial.take(NO_INPUT)).toEqual(NO_INPUT);
  initial.capture({ held: Button.pause, pressed: Button.pause });
  expect(initial.pending).toBe(false);
  const input = { held: Button.soft, pressed: Button.cw };
  expect(initial.take(input)).toEqual(input);
});
