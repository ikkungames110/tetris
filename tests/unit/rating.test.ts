import { expect, it } from 'vitest';
import { ratingTransfer } from '../../packages/core/rating';

it('rewards upsets with a smooth bounded curve even without matchmaking limits', () => {
  expect(ratingTransfer(1000, 1000)).toBe(24);
  expect(ratingTransfer(1000, 1400)).toBe(34);
  expect(ratingTransfer(1400, 1000)).toBe(14);
  let previous = 0;
  for (let opponent = 0; opponent <= 10000; opponent += 100) {
    const value = ratingTransfer(1000, opponent);
    expect(value).toBeGreaterThanOrEqual(4);
    expect(value).toBeLessThanOrEqual(44);
    expect(value).toBeGreaterThanOrEqual(previous);
    previous = value;
  }
});
