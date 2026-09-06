import { createMatch, stateHash, stepMatch } from '../../packages/core/engine';
import { newReplay, recordTick } from '../../packages/core/replay';
import { Button, NO_INPUT, RULES, type Input } from '../../packages/core/types';
import fixture from '../fixtures/sprint-clear.json' with { type: 'json' };

export function completedSprint(extraTicks = 0) {
  const match = createMatch('sprint', fixture.seed);
  const replay = newReplay('sprint', fixture.seed);
  const buttons: Record<string, number> = {
    '.': 0,
    L: Button.left,
    R: Button.right,
    X: Button.cw,
    H: Button.hard,
  };
  for (const key of '.'.repeat(RULES.countdown + extraTicks) + fixture.placements.join('')) {
    const inputs: [Input, Input] = [{ held: 0, pressed: buttons[key] }, NO_INPUT];
    recordTick(replay, inputs);
    stepMatch(match, inputs);
  }
  if (match.winner !== 0) throw new Error('Fixture did not clear 40 lines');
  replay.finalHash = stateHash(match);
  return replay;
}
