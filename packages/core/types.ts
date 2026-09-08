export const PIECES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'] as const;
export type Piece = (typeof PIECES)[number];
export type Cell = Piece | 'G' | null;
export type Rotation = 0 | 1 | 2 | 3;
export type Point = readonly [number, number];
export type Spin = 'none' | 'mini' | 'full';
export type Mode = 'practice' | 'sprint' | 'versus';
export type Handicap = { seat: 0 | 1; lines: 1 | 2 | 3 };

export const Button = {
  left: 1,
  right: 2,
  soft: 4,
  hard: 8,
  ccw: 16,
  cw: 32,
  hold: 64,
  pause: 128,
} as const;
export type Action = keyof typeof Button;
export interface Input {
  held: number;
  pressed: number;
}
export const NO_INPUT: Input = Object.freeze({ held: 0, pressed: 0 });

export interface Rules {
  version: string;
  tickRate: number;
  gravity: number;
  softDrop: number;
  das: number;
  arr: number;
  lockDelay: number;
  lockResets: number;
  entryDelay: number;
  clearDelay: number;
  garbageDelay: number;
  garbageCap: number;
  countdown: number;
  roundLimit: number;
  winsRequired: number;
}
export const RULES: Readonly<Rules> = Object.freeze({
  version: 'ppt2-vs-draft-2',
  tickRate: 60,
  gravity: 60,
  softDrop: 2,
  das: 10,
  arr: 2,
  lockDelay: 30,
  lockResets: 15,
  entryDelay: 0,
  clearDelay: 0,
  garbageDelay: 30,
  garbageCap: 8,
  countdown: 180,
  roundLimit: 60 * 60 * 10,
  winsRequired: 2,
});

export interface ActivePiece {
  type: Piece;
  x: number;
  y: number;
  rotation: Rotation;
}
export interface Bag {
  rng: number;
  remaining: Piece[];
}
export interface Garbage {
  id: number;
  eligibleTick: number;
  lines: number;
}
// Presentation data is delivered separately and never stored in replay state.
export interface ClearEffect {
  tick: number;
  piece: number;
  rows: { y: number; cells: string }[];
}
export type ClearObserver = (player: Player, effect: ClearEffect) => void;
export type RotationObserver = (spin: Spin) => void;
export interface RotationSound {
  tick: number;
  player: number;
  spin: Spin;
}

export interface ClearResult {
  template?: string;
  lines: number;
  spin: Spin;
  perfect: boolean;
  attack: number;
  b2b: boolean;
  ren: number;
}
export interface TemplateProgress {
  id: string;
  variant: number;
  x: number;
  y: number;
  step: number;
}
export interface Player {
  templateProgress?: TemplateProgress[];
  board: Cell[][];
  active: ActivePiece | null;
  bag: Bag;
  next: Piece[];
  hold: Piece | null;
  holdUsed: boolean;
  rotationKick: number | null;
  fallTicks: number;
  lockTicks: number;
  resets: number;
  touchedGround: boolean;
  wait: number;
  direction: -1 | 0 | 1;
  directionTicks: number;
  ren: number;
  b2b: boolean;
  incoming: Garbage[];
  garbageRng: number;
  dead: boolean;
  deathReason: string;
  stats: { pieces: number; lines: number; sent: number; cancelled: number; received: number };
  lastClear: ClearResult | null;
  lastClearTick: number;
}
export interface GameEvent {
  template?: string;
  id: number;
  tick: number;
  player: number;
  type: 'lock' | 'clear' | 'garbage' | 'roundEnd';
  spin?: Spin;
  perfect?: boolean;
  ren?: number;
  amount: number;
}
export interface Match {
  mode: Mode;
  seed: number;
  roundSeed: number;
  tick: number;
  roundTicks: number;
  round: number;
  phase: 'countdown' | 'playing' | 'roundOver' | 'finished';
  countdown: number;
  players: [Player, Player];
  wins: [number, number];
  winner: number | null;
  eventId: number;
  events: GameEvent[];
  rotationSounds?: RotationSound[];
}
