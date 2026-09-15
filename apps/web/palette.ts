import type { Cell } from '../../packages/core/types';

export type Palette = 'original' | 'vivid';
export const PALETTES: Record<Palette, Record<NonNullable<Cell>, string>> = {
  original: {
    I: '#60d7e9',
    J: '#7496f5',
    L: '#efac68',
    O: '#ead773',
    S: '#b7e77f',
    T: '#b49aec',
    Z: '#ef8490',
    G: '#8392a6',
  },
  vivid: {
    I: '#20c9c3',
    J: '#4255d4',
    L: '#f5a623',
    O: '#f4e64c',
    S: '#65dfac',
    T: '#a65aeb',
    Z: '#f57670',
    G: '#8392a6',
  },
};
const storageKey = 'tetcla-palette';
let selected: Palette = 'original';
try {
  if (localStorage.getItem(storageKey) === 'vivid') selected = 'vivid';
} catch {
  /* 保存できない環境でも切り替え可能。 */
}
// Keep the shared object current, including line-clear particles.
export const COLORS = { ...PALETTES[selected] };
export const getPalette = (): Palette => selected;
export function setPalette(value: string): void {
  if (value !== 'original' && value !== 'vivid') return;
  selected = value;
  Object.assign(COLORS, PALETTES[selected]);
  try {
    localStorage.setItem(storageKey, selected);
  } catch {
    /* セッション中は保持。 */
  }
}
