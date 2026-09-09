export const INITIAL_RATING = 1000;

// A bounded, smooth upset bonus. An equal match transfers 24 points;
// a 400-point underdog gains 34, while a 400-point favourite gains 14.
export function ratingTransfer(winner: number, loser: number): number {
  const difference = loser - winner;
  return Math.round(24 + (20 * difference) / (400 + Math.abs(difference)));
}
