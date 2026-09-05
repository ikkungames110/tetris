import { PIECES, type Bag, type Piece } from './types';

// xorshift32-v1. A serialized nonzero uint32 is the entire PRNG state.
export function random32(state: number): number {
  let x = state >>> 0 || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

// xorshift32 has period 2^32-1 and outputs 1..2^32-1. Rejection avoids modulo bias.
export function uniform(state: number, bound: number): [number, number] {
  const limit = Math.floor(0xffffffff / bound) * bound;
  let next = state;
  do {
    next = random32(next);
  } while (next - 1 >= limit);
  return [next, (next - 1) % bound];
}

export function takePiece(bag: Bag): Piece {
  if (!bag.remaining.length) {
    bag.remaining = [...PIECES];
    for (let i = 6; i > 0; i--) {
      const [state, j] = uniform(bag.rng, i + 1);
      bag.rng = state;
      [bag.remaining[i], bag.remaining[j]] = [bag.remaining[j], bag.remaining[i]];
    }
  }
  return bag.remaining.shift()!;
}
