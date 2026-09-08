export function renderLen(element: HTMLElement, ren: number): void {
  if (element.dataset.len === String(ren)) return;
  element.dataset.len = String(ren);
  element.hidden = ren < 2;
  if (ren < 2) return;
  element.querySelector('strong')!.textContent = String(ren);
  element.style.setProperty('--len-font', `${Math.min(30, 13 + (ren - 2) * 1.25)}px`);
  element.setAttribute('aria-label', `${ren}len（連続消去）`);
}
