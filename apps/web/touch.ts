import { Button, type Action } from '../../packages/core/types';
import type { InputManager } from './input';

// 幅の狭いウィンドウと、横向きのスマホを同じレイアウトにする。
export const MOBILE_LAYOUT_QUERY = '(max-width: 760px), (pointer: coarse) and (max-width: 1100px)';

export class TouchControls {
  private pointers = new Map<number, HTMLButtonElement>();
  private enabled = false;

  constructor(
    private root: HTMLElement,
    private input: InputManager,
    private layout: MediaQueryList,
  ) {
    root.addEventListener('pointerdown', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        'button[data-touch-action]',
      );
      if (!button || !this.enabled || !layout.matches || event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, button);
      button.classList.add('pressed');
      input.pressTouch(event.pointerId, Button[button.dataset.touchAction as Action]);
    });
    const release = (event: PointerEvent) => {
      const button = this.pointers.get(event.pointerId);
      if (!button) return;
      this.pointers.delete(event.pointerId);
      input.releaseTouch(event.pointerId, event.type !== 'pointerup');
      if (![...this.pointers.values()].includes(button)) button.classList.remove('pressed');
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    root.addEventListener('lostpointercapture', release);
    root.addEventListener('contextmenu', (event) => event.preventDefault());
    root.addEventListener('click', (event) => {
      // キーボード・支援技術によるボタンの実行も受け付ける。
      if (event.detail !== 0 || !this.enabled || !layout.matches) return;
      const button = (event.target as Element).closest<HTMLButtonElement>(
        'button[data-touch-action]',
      );
      if (!button) return;
      input.pressTouch(-1, Button[button.dataset.touchAction as Action]);
      input.releaseTouch(-1);
    });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
    layout.addEventListener('change', () => this.clear());
    window.addEventListener('resize', () => this.clear());
    this.setEnabled(false);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.layout.matches;
    if (!this.enabled) this.clear();
    this.root.querySelectorAll('button').forEach((button) => (button.disabled = !this.enabled));
  }

  private clear(): void {
    for (const [id, button] of this.pointers) {
      if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
      button.classList.remove('pressed');
    }
    this.pointers.clear();
    this.input.clearTouch();
  }
}
