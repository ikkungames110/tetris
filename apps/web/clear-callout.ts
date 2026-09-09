export class ClearCallout {
  private key = '';
  private animation: Animation | null = null;
  private text = document.createElement('span');
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private element: HTMLElement) {
    this.text.className = 'clear-text';
    const trails = ['before', 'after'].map((side) => {
      const trail = document.createElement('span');
      trail.className = `clear-streaks clear-streaks-${side}`;
      trail.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i++) trail.append(document.createElement('i'));
      return trail;
    });
    element.replaceChildren(trails[0], this.text, trails[1]);
  }

  update(label: string, key: string): void {
    if (!label) {
      if (this.key) this.reset();
      return;
    }
    if (this.key === key) return;
    this.key = key;
    this.animation?.cancel();
    this.text.textContent = label;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const angle = Math.random() * 32 - 16;
    const rotation = `rotate(${angle}deg)`;
    const x = direction * Math.min(24, this.element.getBoundingClientRect().width * 0.08);
    const y = Math.tan((angle * Math.PI) / 180) * x;
    this.element.dataset.direction = direction < 0 ? 'right' : 'left';
    const resting = `translate(0, 0) ${rotation}`;
    this.animation = this.element.animate(
      this.reduced.matches
        ? [
            { opacity: 0, offset: 0, easing: 'ease-out' },
            { opacity: 0.62, offset: 0.22 },
            { opacity: 0.62, offset: 0.72, easing: 'ease-in' },
            { opacity: 0, offset: 1 },
          ]
        : [
            {
              transform: `translate(${x}px, ${y}px) ${rotation}`,
              opacity: 0,
              offset: 0,
              easing: 'ease-out',
            },
            { transform: resting, opacity: 0.62, offset: 0.22 },
            {
              transform: resting,
              opacity: 0.62,
              offset: 0.72,
              easing: 'ease-in',
            },
            {
              transform: `translate(${-x}px, ${-y}px) ${rotation}`,
              opacity: 0,
              offset: 1,
            },
          ],
      { duration: 1700, fill: 'both' },
    );
  }

  reset(): void {
    this.key = '';
    this.animation?.cancel();
    this.animation = null;
    this.text.textContent = '';
  }
}
