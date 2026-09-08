export function renderRen(element: HTMLElement, ren: number): void {
  if (element.dataset.ren === String(ren)) return;
  element.dataset.ren = String(ren);
  // エンジンは初回消去を0で保持する。画面では実際の連続消去回数を表示する。
  const count = ren + 1;
  element.hidden = count < 2;
  if (count < 2) return;
  element.querySelector('strong')!.textContent = String(count);
  element.style.setProperty('--ren-font', `${Math.min(40, 22 + (count - 2) * 2)}px`);
  // 数字の桁数に合わせて横一行で収まる上限をCSS側で計算する。
  element.style.setProperty('--ren-fit-units', String(String(count).length * 0.6 + 1.35));
  element.setAttribute('aria-label', `${count} REN（連続消去）`);
}
