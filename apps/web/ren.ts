export function renderRen(element: HTMLElement, ren: number): void {
  if (element.dataset.ren === String(ren)) return;
  element.dataset.ren = String(ren);
  element.hidden = ren < 2;
  if (ren < 2) return;
  element.querySelector('strong')!.textContent = String(ren);
  element.style.setProperty('--ren-font', `${Math.min(30, 13 + (ren - 2) * 1.25)}px`);
  // 数字の桁数に合わせて横一行で収まる上限をCSS側で計算する。
  element.style.setProperty('--ren-fit-units', String(String(ren).length * 0.65 + 1.8));
  element.setAttribute('aria-label', `${ren} REN（連続消去）`);
}
