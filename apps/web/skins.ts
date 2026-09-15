export type Skin = 'classic' | 'crystal' | 'metal' | 'neon' | 'texture' | 'pattern';
const storageKey = 'tetcla-skin';
const validSkin = (value: unknown): value is Skin =>
  value === 'classic' ||
  value === 'crystal' ||
  value === 'metal' ||
  value === 'neon' ||
  value === 'texture' ||
  value === 'pattern';

let selected: Skin = 'texture';
try {
  const saved = localStorage.getItem(storageKey);
  if (validSkin(saved)) selected = saved;
} catch {
  // Storage can be unavailable; the selection still works for this tab.
}

export const getSkin = (): Skin => selected;
export function setSkin(value: string): void {
  if (!validSkin(value)) return;
  selected = value;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Optional persistence.
  }
}
