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
    const angle = ((Math.random() * 32 - 16) * Math.PI) / 180;
    const x = direction * (this.element.getBoundingClientRect().width + 80);
    const y = Math.tan(angle) * x;
    this.element.style.setProperty('--flight-angle', `${(angle * 180) / Math.PI}deg`);
    this.element.dataset.direction = direction < 0 ? 'right' : 'left';
    const resting = 'translate(0, 0) rotate(-4deg)';
    this.animation = this.element.animate(
      this.reduced.matches
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: 0.1 },
            { opacity: 1, offset: 0.8 },
            { opacity: 0, offset: 1 },
          ]
        : [
            {
              transform: `translate(${x}px, ${y}px) rotate(${direction * 12}deg)`,
              opacity: 0,
              offset: 0,
              easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            },
            { transform: resting, opacity: 1, offset: 0.25 },
            {
              transform: resting,
              opacity: 1,
              offset: 0.7,
              easing: 'cubic-bezier(0.7, 0, 0.84, 0)',
            },
            {
              transform: `translate(${-x}px, ${-y}px) rotate(${-direction * 10}deg)`,
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
