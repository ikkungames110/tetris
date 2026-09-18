import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../../apps/web/input';
import { Button } from '../../packages/core/types';

let events: EventTarget;
function key(type: string, code: string, repeat = false) {
  events.dispatchEvent(Object.assign(new Event(type), { code, repeat }));
}
beforeEach(() => {
  events = new EventTarget();
  vi.stubGlobal('window', events);
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  for (const name of ['HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'])
    vi.stubGlobal(name, class {});
});
afterEach(() => vi.unstubAllGlobals());

describe('keyboard horizontal input edges', () => {
  it.each([
    ['ArrowLeft', 'ArrowRight', 1],
    ['ArrowRight', 'ArrowLeft', -1],
  ] as const)('keeps %s → %s order before a poll', (first, second, last) => {
    const input = new InputManager();
    key('keydown', first);
    key('keydown', second);
    input.poll();
    expect(input.consume()[0]).toMatchObject({
      held: Button.left | Button.right,
      pressed: Button.left | Button.right,
      lastHorizontalDirection: last,
    });
  });

  it('preserves the latest press across polls before a simulation tick', () => {
    const input = new InputManager();
    key('keydown', 'ArrowRight');
    input.poll();
    key('keydown', 'ArrowLeft');
    input.poll();
    expect(input.consume()[0].lastHorizontalDirection).toBe(-1);
  });

  it('does not synthesize a horizontal keydown when countdown ends or OS repeat arrives', () => {
    const input = new InputManager();
    key('keydown', 'ArrowLeft');
    input.poll();
    input.consume();
    key('keydown', 'ArrowLeft', true);
    input.activateHeld();
    expect(input.consume()[0]).toMatchObject({ held: Button.left, pressed: 0 });
    key('keyup', 'ArrowLeft');
    input.poll();
    expect(input.consume()[0]).toMatchObject({ held: 0, pressed: 0 });
  });
});
