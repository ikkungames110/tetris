import { Button, type Input } from '../../packages/core/types';

// カウント中の短い入力を、最初のミノに一度だけ適用する。
export class InitialInput {
  private pressed = 0;

  get pending(): boolean {
    return this.pressed !== 0;
  }

  reset(): void {
    this.pressed = 0;
  }

  capture(input: Input): void {
    const pressed = input.pressed & ~Button.pause;
    // 左右・回転方向は最後に押した方向を優先する。
    for (const pair of [Button.left | Button.right, Button.cw | Button.ccw])
      if (pressed & pair) this.pressed &= ~pair;
    this.pressed |= pressed;
  }

  take(input: Input): Input {
    if (!this.pending) return input;
    this.capture(input);
    const pressed = this.pressed;
    // HOLDで処理が終わるため、同時に予約された回転・移動等は次のtickへ残す。
    this.pressed = pressed & Button.hold ? pressed & ~Button.hold : 0;
    return { held: input.held, pressed: pressed & Button.hold ? Button.hold : pressed };
  }
}
