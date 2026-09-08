// 長押しリスタートはゲームパッド・キー・画面ボタン共通で、リプレイの操作記録とは分離する。
export class HoldReset {
  private since: number | null = null;
  private blocked = false;

  cancel(): void {
    this.since = null;
    this.blocked = true;
  }

  update(pressed: boolean, enabled: boolean, now: number): boolean {
    if (!pressed) {
      this.since = null;
      this.blocked = false;
      return false;
    }
    if (!enabled) this.cancel();
    if (this.blocked) return false;
    this.since ??= now;
    if (now - this.since < 1000) return false;
    this.cancel();
    return true;
  }
}
