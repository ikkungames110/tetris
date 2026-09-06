import { describe, expect, it } from 'vitest';
import {
  captureBinding,
  defaultBindings,
  padName,
  emptyBindings,
  readPad,
  standardBindings,
  validBindings,
  type Pad,
} from '../../apps/web/gamepad';
import { Button } from '../../packages/core/types';

const pad = (pressed: number[] = [], axes = [0, 0, 0, 0]): Pad => ({
  id: 'Wireless Controller (054c:09cc)',
  index: 0,
  mapping: 'standard',
  connected: true,
  buttons: Array.from({ length: 18 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  })),
  axes,
});

describe('DualShock 4 / W3C standard mapping', () => {
  it.each([
    [14, Button.left],
    [15, Button.right],
    [13, Button.soft],
    [12, Button.hard],
    [0, Button.ccw],
    [2, Button.ccw],
    [1, Button.cw],
    [3, Button.hard],
    [4, Button.hold],
    [5, Button.hold],
    [9, Button.pause],
  ])('button %i maps to action %i', (physical, action) => {
    expect(readPad(pad([physical]), standardBindings(), false)).toBe(action);
  });
  it('supports multiple buttons and diagonal D-pad presses', () => {
    expect(readPad(pad([14, 13, 1]), standardBindings(), false)).toBe(
      Button.left | Button.soft | Button.cw,
    );
  });
  it('ignores analog drift, uses hysteresis, and never hard-drops on stick up', () => {
    expect(readPad(pad([], [0.3, 0.25]), standardBindings(), true)).toBe(0);
    expect(readPad(pad([], [-0.8, 0]), standardBindings(), false)).toBe(0);
    expect(readPad(pad([], [-0.8, 0]), standardBindings(), true)).toBe(Button.left);
    expect(readPad(pad([], [-0.5, 0]), standardBindings(), true, Button.left)).toBe(Button.left);
    expect(readPad(pad([], [-0.3, 0]), standardBindings(), true, Button.left)).toBe(0);
    expect(readPad(pad([], [0, -1]), standardBindings(), true)).toBe(0);
  });
  it('releases on disconnect and handles sparse/missing controls', () => {
    expect(readPad({ ...pad([4]), connected: false }, standardBindings(), true)).toBe(0);
    expect(readPad(undefined, standardBindings(), true)).toBe(0);
    expect(readPad({ ...pad(), buttons: [], axes: [] }, standardBindings(), true)).toBe(0);
  });
  it('captures button, axis and raw DS4 hat bindings', () => {
    expect(captureBinding(pad(), pad([1]))).toEqual({ kind: 'button', index: 1 });
    expect(captureBinding(pad(), pad([], [-1, 0]))).toEqual({ kind: 'axis', index: 0, sign: -1 });
    const hat = [...Array(9).fill(0), 1.2857];
    expect(captureBinding(pad([], hat), pad([], [...Array(9).fill(0), -1]))).toEqual({
      kind: 'hat',
      index: 9,
      value: -1,
    });
    const bindings = emptyBindings();
    bindings.left = [{ kind: 'hat', index: 9, value: -1 }];
    expect(readPad(pad([], [...Array(9).fill(0), -1]), bindings, false)).toBe(Button.left);
    expect(readPad(pad([], hat), bindings, false)).toBe(0);
  });
  it('validates persisted settings and uses custom bindings', () => {
    const bindings = standardBindings();
    bindings.hold = [{ kind: 'button', index: 7 }];
    expect(readPad(pad([7]), bindings, false)).toBe(Button.hold);
    expect(validBindings(bindings)).toBe(true);
    expect(validBindings({ ...bindings, hard: [{ kind: 'button', index: -1 }] })).toBe(false);
    expect(validBindings(null)).toBe(false);
    expect(validBindings({})).toBe(false);
  });
});

it('provides standard controls for Xbox, PlayStation, Nintendo and generic mapped pads', () => {
  for (const id of [
    'Xbox Wireless Controller',
    'DualSense',
    'Nintendo Switch Pro Controller',
    'USB gamepad',
  ]) {
    const device = { ...pad([4]), id };
    expect(readPad(device, defaultBindings(device), false)).toBe(Button.hold);
  }
  expect(padName({ ...pad(), id: 'DualSense Wireless Controller' })).toBe('DualSense');
  expect(padName({ ...pad(), id: 'Xbox Wireless Controller' })).toBe('Xbox');
});

it('gives unmapped USB pads axis movement and face buttons without requiring setup first', () => {
  const device = { ...pad([3], [-1, 0]), mapping: '', buttons: pad([3]).buttons.slice(0, 8) };
  const defaults = defaultBindings(device);
  expect(Object.values(defaults).every((bindings) => bindings.length > 0)).toBe(true);
  expect(readPad(device, defaults, false)).toBe(Button.left | Button.hard);
});
