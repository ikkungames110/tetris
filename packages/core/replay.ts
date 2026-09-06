import { createMatch, nextRound, stateHash, stepMatch } from './engine';
import { RULES, type Input, type Match, type Mode, type Rules } from './types';

// Saved games retain the timing rules under which their inputs were recorded.
const LEGACY_RULES: Readonly<Rules> = Object.freeze({
  ...RULES,
  version: 'ppt2-vs-draft-1',
  entryDelay: 6,
  clearDelay: 30,
});

export const ENGINE_VERSION = '0.1.0';
export interface ReplayRun {
  ticks: number;
  inputs: [Input, Input];
}
export interface Replay {
  version: 1;
  engineVersion: string;
  rulesVersion: string;
  mode: Mode;
  seed: number;
  rounds: ReplayRun[][];
  finalHash: string;
}

export function newReplay(mode: Mode, seed: number): Replay {
  return {
    version: 1,
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES.version,
    mode,
    seed,
    rounds: [[]],
    finalHash: '',
  };
}

export function recordTick(replay: Replay, inputs: [Input, Input]): void {
  const runs = replay.rounds.at(-1)!;
  const last = runs.at(-1);
  if (
    last &&
    inputs.every(
      (input, i) => input.held === last.inputs[i].held && input.pressed === last.inputs[i].pressed,
    )
  )
    last.ticks++;
  else runs.push({ ticks: 1, inputs: structuredClone(inputs) });
}

export function parseReplay(json: string): Replay {
  if (json.length > 5_000_000) throw new Error('リプレイは5 MB以下にしてください。');
  const value = JSON.parse(json) as Replay;
  if (
    !value ||
    value.version !== 1 ||
    value.engineVersion !== ENGINE_VERSION ||
    (value.rulesVersion !== RULES.version && value.rulesVersion !== LEGACY_RULES.version)
  )
    throw new Error('対応していないリプレイの版です。');
  if (
    !['practice', 'versus'].includes(value.mode) ||
    !Number.isInteger(value.seed) ||
    value.seed < 1 ||
    value.seed > 0xffffffff
  )
    throw new Error('リプレイの初期設定が不正です。');
  if (!Array.isArray(value.rounds) || !value.rounds.length || value.rounds.length > 100)
    throw new Error('ラウンドの記録が不正です。');
  let ticks = 0;
  for (const round of value.rounds) {
    if (!Array.isArray(round)) throw new Error('入力の記録が不正です。');
    for (const run of round) {
      if (
        !run ||
        !Number.isInteger(run.ticks) ||
        run.ticks < 1 ||
        !Array.isArray(run.inputs) ||
        run.inputs.length !== 2
      )
        throw new Error('入力の記録が不正です。');
      ticks += run.ticks;
      for (const input of run.inputs) {
        if (
          !input ||
          ![input.held, input.pressed].every(
            (mask) => Number.isInteger(mask) && mask >= 0 && mask <= 255,
          )
        )
          throw new Error('ボタンの記録が不正です。');
      }
    }
  }
  if (ticks > 216_000 || !/^[0-9a-f]{8}$/.test(value.finalHash))
    throw new Error('リプレイが長すぎるか、検証値が不正です。');
  return value;
}

export class ReplayPlayer {
  match: Match;
  done = false;
  valid = false;
  private round = 0;
  private run = 0;
  private offset = 0;
  private rules: Readonly<Rules>;

  constructor(readonly replay: Replay) {
    this.rules = replay.rulesVersion === LEGACY_RULES.version ? LEGACY_RULES : RULES;
    this.match = createMatch(replay.mode, replay.seed, this.rules);
  }

  step(): void {
    if (this.done) return;
    const runs = this.replay.rounds[this.round];
    if (this.run >= runs.length) {
      if (this.round + 1 < this.replay.rounds.length) {
        if (this.match.phase !== 'roundOver') throw new Error('ラウンドの切り替え位置が不正です。');
        nextRound(this.match, this.rules);
        this.round++;
        this.run = 0;
        this.offset = 0;
        return;
      }
      this.done = true;
      this.valid = stateHash(this.match) === this.replay.finalHash;
      return;
    }
    if (this.match.phase === 'roundOver' || this.match.phase === 'finished')
      throw new Error('終了後の入力が記録されています。');
    const current = runs[this.run];
    stepMatch(this.match, current.inputs, this.rules);
    if (++this.offset >= current.ticks) {
      this.run++;
      this.offset = 0;
    }
  }
}
