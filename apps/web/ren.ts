export function renderRen(element: HTMLElement, ren: number): void {
  if (element.dataset.ren === String(ren)) return;
  element.dataset.ren = String(ren);
  // エンジンは初回消去を0で保持する。画面では実際の連続消去回数を表示する。
  const count = ren + 1;
  const appearing = element.hidden;
  for (const animation of element.getAnimations()) animation.cancel();
  element.hidden = count < 2;
  if (count < 2) return;
  element.querySelector('strong')!.textContent = String(count);
  element.dataset.color =
    count >= 15 ? 'rainbow' : count >= 10 ? 'red' : count >= 5 ? 'yellow' : 'green';
  // 数字の桁数に合わせて横一行で収まる上限をCSS側で計算する。
  element.style.setProperty('--ren-fit-units', String(String(count).length * 0.6 + 1.35));
  element.setAttribute('aria-label', `${count} REN（連続消去）`);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.animate(
    [
      {
        opacity: appearing ? 0 : 0.55,
        ...(reduced ? {} : { transform: `translateY(${appearing ? 4 : 2}px)` }),
      },
      { opacity: 1, ...(reduced ? {} : { transform: 'translateY(0)' }) },
    ],
    { duration: appearing ? 240 : 180, easing: 'ease-out' },
  );
}
