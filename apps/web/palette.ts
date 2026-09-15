import type { Cell } from '../../packages/core/types';

const ORIGINAL: Record<NonNullable<Cell>, string> = {
  I: '#60d7e9',
  J: '#7496f5',
  L: '#efac68',
  O: '#ead773',
  S: '#b7e77f',
  T: '#b49aec',
  Z: '#ef8490',
  G: '#8392a6',
};
const storageKey = 'tetcla-color-adjustments';
let saturation = 100;
let transparency = 0;
const percent = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
  saturation = percent(saved?.saturation, 100);
  transparency = percent(saved?.transparency, 0);
} catch {
  /* 保存できない環境では既定値を使う。 */
}
export const COLORS = { ...ORIGINAL };
export const getSaturation = (): number => saturation;
export const getTransparency = (): number => transparency;
export const appearanceKey = (): string => `${saturation}:${transparency}`;
function updateColors(): void {
  for (const type of Object.keys(ORIGINAL) as NonNullable<Cell>[]) {
    const rgb = ORIGINAL[type]
      .slice(1)
      .match(/../g)!
      .map((value) => parseInt(value, 16));
    // Scale HSL saturation, keeping the original hue and lightness. 100% is the original color.
    const gray = (Math.max(...rgb) + Math.min(...rgb)) / 2;
    COLORS[type] =
      '#' +
      rgb
        .map((value) =>
          Math.round(gray + ((value - gray) * saturation) / 100)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
  }
}
export function setColorAdjustment(kind: 'saturation' | 'transparency', value: number): void {
  if (kind === 'saturation') saturation = percent(value, saturation);
  else transparency = percent(value, transparency);
  updateColors();
  try {
    localStorage.setItem(storageKey, JSON.stringify({ saturation, transparency }));
  } catch {
    /* セッション中は保持。 */
  }
}
updateColors();
