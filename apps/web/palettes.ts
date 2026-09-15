import type { Cell } from '../../packages/core/types';

type Colors = Record<NonNullable<Cell>, string>;

export const PALETTES = [
  {
    id: 'aurora',
    name: '01 オーロラ',
    colors: {
      I: '#f28cab',
      J: '#a6d977',
      L: '#a99cf0',
      O: '#6ccbb8',
      S: '#efb76c',
      T: '#78afe8',
      Z: '#e5dba0',
      G: '#8392a6',
    },
  },
  {
    id: 'sunset',
    name: '02 サンセット',
    colors: {
      I: '#f0b665',
      J: '#cf8cbd',
      L: '#7ac5be',
      O: '#ed8992',
      S: '#8b9de0',
      T: '#d5ce89',
      Z: '#b3d3b7',
      G: '#8392a6',
    },
  },
  {
    id: 'botanical',
    name: '03 ボタニカル',
    colors: {
      I: '#a9cf87',
      J: '#e4b974',
      L: '#c890a5',
      O: '#8badd5',
      S: '#d4d2b5',
      T: '#6fb8a0',
      Z: '#b6a1d6',
      G: '#8392a6',
    },
  },
  {
    id: 'candy',
    name: '04 キャンディ',
    colors: {
      I: '#c7a5f5',
      J: '#f5a6ae',
      L: '#b8df8d',
      O: '#95d6ed',
      S: '#f4cfa0',
      T: '#a0e2cd',
      Z: '#e9b7df',
      G: '#8392a6',
    },
  },
  {
    id: 'arcade',
    name: '05 アーケード',
    colors: {
      I: '#f4d35e',
      J: '#50d6ad',
      L: '#ed70bd',
      O: '#a595f5',
      S: '#6eaff7',
      T: '#f69b65',
      Z: '#bce66b',
      G: '#8392a6',
    },
  },
] as const satisfies readonly { id: string; name: string; colors: Colors }[];

const storageKey = 'tetcla-palette';
let selected: (typeof PALETTES)[number] = PALETTES[0];
try {
  const saved = localStorage.getItem(storageKey);
  selected = PALETTES.find((palette) => palette.id === saved) ?? PALETTES[0];
} catch {
  // 保存できない環境でも、このタブでは配色を切り替えられる。
}

export const COLORS: Colors = { ...selected.colors };
export const getPalette = (): string => selected.id;
export function setPalette(id: string): void {
  const palette = PALETTES.find((candidate) => candidate.id === id);
  if (!palette) return;
  selected = palette;
  Object.assign(COLORS, palette.colors);
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    // 保存は任意。
  }
}
