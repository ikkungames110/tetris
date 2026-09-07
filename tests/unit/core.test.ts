import { describe, expect, it } from 'vitest';
import { calculateAttack, cancelGarbage, detectSpin, renBonus } from '../../packages/core/attack';
import {
  createMatch,
  createPlayer,
  emptyBoard,
  lockPiece,
  nextRound,
  receiveGarbage,
  spawn,
  stateHash,
  stepMatch,
  stepPlayer,
} from '../../packages/core/engine';
import { cells, collides, HIDDEN, rotate, shape } from '../../packages/core/pieces';
import { takePiece } from '../../packages/core/random';
import { newReplay, parseReplay, recordTick, ReplayPlayer } from '../../packages/core/replay';
import { clearLabel } from '../../apps/web/render';
import {
  Button,
  NO_INPUT,
  PIECES,
  RULES,
  type Input,
  type Handicap,
  type Piece,
  type Player,
  type Rotation,
} from '../../packages/core/types';

const press = (button: number): Input => ({ held: button, pressed: button });
const fill = (player: Player, y: number, except: number[] = []) => {
  player.board[y + HIDDEN] = Array.from({ length: 10 }, (_, x) =>
    except.includes(x) ? null : 'G',
  );
};
function tetrisFixture(player: Player): void {
  player.board = emptyBoard();
  for (let y = 16; y < 20; y++) fill(player, y, [4]);
  player.board[HIDDEN + 10][0] = 'J';
  player.active = { type: 'I', x: 2, y: 16, rotation: 1 };
}

describe('7-bag / deterministic state', () => {
  it('10,000 bags contain every piece exactly once and bound streaks/droughts', () => {
    const bag = { rng: 17, remaining: [] as Piece[] };
    const last = Object.fromEntries(PIECES.map((p) => [p, -1]));
    const sequence: Piece[] = [];
    for (let n = 0; n < 10_000; n++) {
      const group = Array.from({ length: 7 }, () => takePiece(bag));
      expect([...group].sort()).toEqual([...PIECES].sort());
      for (const piece of group) {
        const i = sequence.length;
        if (last[piece] >= 0) expect(i - last[piece] - 1).toBeLessThanOrEqual(12);
        if (i > 1) expect(sequence[i - 1] === piece && sequence[i - 2] === piece).toBe(false);
        last[piece] = i;
        sequence.push(piece);
      }
    }
  });
  it('players share piece order but garbage never consumes the piece PRNG', () => {
    const a = createPlayer(55, 99);
    const b = createPlayer(55, 10);
    a.incoming.push({ id: 1, eligibleTick: 0, lines: 8 });
    receiveGarbage(a, 0);
    for (let i = 0; i < 100; i++) {
      expect(a.next).toEqual(b.next);
      spawn(a);
      spawn(b);
    }
  });
  it('serialized checkpoints include timers, input state, queues and PRNG state', () => {
    const original = createMatch('versus', 63);
    for (let i = 0; i < 210; i++)
      stepMatch(original, [press(i === 200 ? Button.hold : 0), NO_INPUT]);
    const restored = JSON.parse(JSON.stringify(original));
    for (let i = 0; i < 500; i++) {
      const inputs = [
        { held: i % 30 < 15 ? Button.left : Button.right, pressed: i % 60 === 0 ? Button.hard : 0 },
        NO_INPUT,
      ];
      stepMatch(original, inputs);
      stepMatch(restored, inputs);
    }
    expect(stateHash(restored)).toBe(stateHash(original));
  });
});

describe('SRS geometry', () => {
  it.each(PIECES)(
    '%s has four unique cells and four rotations return to its spawn form',
    (piece) => {
      let a = { type: piece, x: 3, y: 5, rotation: 0 as Rotation };
      for (let i = 0; i < 4; i++) {
        expect(new Set(cells(a).map((cell) => cell.join(','))).size).toBe(4);
        if (piece !== 'O') a = rotate(emptyBoard(), a, 1)!.active;
      }
      expect(a.rotation).toBe(0);
      expect(a.x).toBe(3);
      expect(a.y).toBe(5);
    },
  );
  it('floor-kicks T up by one using candidate 3 (board Y is down)', () => {
    const result = rotate(emptyBoard(), { type: 'T', x: 4, y: 18, rotation: 0 }, 1)!;
    expect(result.kick).toBe(3);
    expect(result.active).toMatchObject({ x: 3, y: 17, rotation: 1 });
  });
  it('floor-kicks I using its own candidate 5, not the normal table', () => {
    const result = rotate(emptyBoard(), { type: 'I', x: 3, y: 18, rotation: 0 }, 1)!;
    expect(result.kick).toBe(5);
    expect(result.active).toMatchObject({ x: 4, y: 16, rotation: 1 });
  });
  it('wall-kicks a vertical T out of the left wall', () => {
    const result = rotate(emptyBoard(), { type: 'T', x: -1, y: 7, rotation: 1 }, -1)!;
    expect(result.kick).toBe(2);
    expect(result.active.x).toBe(0);
  });
  it('rejects all obstructed candidates without changing the active piece', () => {
    const board = Array.from({ length: 40 }, () => Array(10).fill('G'));
    const active = { type: 'T' as const, x: 3, y: 10, rotation: 0 as const };
    for (const [x, y] of cells(active)) board[y + HIDDEN][x] = null;
    expect(rotate(board, active, 1)).toBeNull();
    expect(active).toEqual({ type: 'T', x: 3, y: 10, rotation: 0 });
  });
  it('allows hidden rows, blocks the internal top, and keeps O stationary', () => {
    expect(collides(emptyBoard(), { type: 'T', x: 3, y: -3, rotation: 0 })).toBe(false);
    expect(collides(emptyBoard(), { type: 'T', x: 3, y: -21, rotation: 0 })).toBe(true);
    expect(shape('O', 0)).toEqual(shape('O', 3));
  });
});

describe('movement, timing and HOLD', () => {
  it('HOLD consumes NEXT once when empty, swaps without consuming, and cannot repeat until lock', () => {
    const p = createPlayer(1, 2);
    const initial = p.active!.type;
    const firstNext = p.next[0];
    stepPlayer(p, press(Button.hold), 0);
    expect(p.hold).toBe(initial);
    expect(p.active!.type).toBe(firstNext);
    const next = [...p.next];
    stepPlayer(p, press(Button.hold), 1);
    expect(p.next).toEqual(next);
    expect(p.hold).toBe(initial);
    stepPlayer(p, press(Button.hard), 2);
    stepPlayer(p, NO_INPUT, 3);
    const third = p.active!.type;
    const beforeSwap = [...p.next];
    stepPlayer(p, press(Button.hold), 12);
    expect(p.hold).toBe(third);
    expect(p.active!.type).toBe(initial);
    expect(p.next).toEqual(beforeSwap);
    expect(p.active!.rotation).toBe(0);
    expect(p.lockTicks).toBe(0);
  });
  it('one hard drop locks one piece even when held as the next piece spawns', () => {
    const p = createPlayer(1, 2);
    stepPlayer(p, press(Button.hard), 0);
    for (let i = 1; i < 50; i++) stepPlayer(p, { held: Button.hard, pressed: 0 }, i);
    expect(p.stats.pieces).toBe(1);
  });
  it('implements immediate movement, DAS 10, ARR 2 independently of OS repeat', () => {
    const p = createPlayer(1, 2);
    stepPlayer(p, press(Button.left), 0);
    expect(p.active!.x).toBe(2);
    for (let i = 1; i < 10; i++) stepPlayer(p, { held: Button.left, pressed: 0 }, i);
    expect(p.active!.x).toBe(2);
    stepPlayer(p, { held: Button.left, pressed: 0 }, 10);
    expect(p.active!.x).toBe(1);
    stepPlayer(p, { held: Button.left, pressed: 0 }, 11);
    expect(p.active!.x).toBe(1);
    stepPlayer(p, { held: Button.left, pressed: 0 }, 12);
    expect(p.active!.x).toBe(0);
  });
  it('neutralizes simultaneous directions and honors the later direction', () => {
    const p = createPlayer(1, 2);
    const both = Button.left | Button.right;
    stepPlayer(p, press(both), 0);
    expect(p.active!.x).toBe(3);
    stepPlayer(p, { held: both, pressed: Button.right }, 1);
    expect(p.active!.x).toBe(4);
  });
  it('stops extending lock delay at the reset cap, including O rotations', () => {
    const p = createPlayer(1, 2);
    p.active = { type: 'T', x: 3, y: 18, rotation: 0 };
    p.resets = 15;
    p.lockTicks = 29;
    stepPlayer(p, press(Button.right), 1);
    expect(p.stats.pieces).toBe(1);
    const o = createPlayer(1, 2);
    o.active = { type: 'O', x: 3, y: 18, rotation: 0 };
    for (let i = 0; i < 30; i++) stepPlayer(o, press(Button.cw), i);
    expect(o.stats.pieces).toBe(1);
  });
});

describe('continuous play after locking and clearing', () => {
  it.each(['lock', 'single', 'tetris', 't-spin'])(
    'accepts movement and rotation on the very next tick after %s while keeping the label',
    (kind) => {
      const p = createPlayer(1, 2);
      if (kind === 'single') {
        fill(p, 19, [4, 5]);
        p.active = { type: 'O', x: 3, y: 18, rotation: 0 };
      } else if (kind === 'tetris') tetrisFixture(p);
      else if (kind === 't-spin') {
        fill(p, 18, [3, 4, 5]);
        fill(p, 19, [4]);
        p.board[HIDDEN + 17][3] = 'J';
        p.active = { type: 'T', x: 3, y: 17, rotation: 2 };
        p.rotationKick = 1;
      }
      p.next[0] = 'T';
      stepPlayer(p, press(Button.hard), 0);
      const label = clearLabel(p, 0);
      expect(label).toBe(
        { lock: '', single: '', tetris: '4LINES', 't-spin': 'T-SPIN DOUBLE' }[kind],
      );
      stepPlayer(p, press(Button.left | Button.cw), 1);
      expect(p.active).toMatchObject({ type: 'T', x: 2, rotation: 1 });
      expect(clearLabel(p, 1)).toBe(label);
    },
  );
  it.each([Button.hold, Button.hard])('accepts action %i immediately after a clear', (button) => {
    const p = createPlayer(1, 2);
    tetrisFixture(p);
    const next = p.next[0];
    stepPlayer(p, press(Button.hard), 0);
    stepPlayer(p, press(button), 1);
    if (button === Button.hold) {
      expect(p.hold).toBe(next);
      expect(p.holdUsed).toBe(true);
    } else expect(p.stats.pieces).toBe(2);
    expect(clearLabel(p, 1)).toBe('4LINES');
  });
});

describe('T-Spin, B2B, REN and PC', () => {
  it('recognizes TSD from the pre-clear board and produces 4 attack', () => {
    const p = createPlayer(1, 2);
    p.board = emptyBoard();
    fill(p, 18, [3, 4, 5]);
    fill(p, 19, [4]);
    p.board[HIDDEN + 17][3] = 'J';
    p.active = { type: 'T', x: 3, y: 17, rotation: 2 };
    p.rotationKick = 1;
    const result = stepPlayer(p, press(Button.hard), 0)!;
    expect(result).toMatchObject({ spin: 'full', lines: 2, attack: 4, perfect: false });
  });
  it('preserves Mini Double rather than automatically promoting two lines', () => {
    const p = createPlayer(1, 2);
    p.board = emptyBoard();
    fill(p, 18, [4, 5]);
    fill(p, 19, [4]);
    p.board[HIDDEN + 17][3] = 'J';
    p.active = { type: 'T', x: 3, y: 17, rotation: 1 };
    p.rotationKick = 1;
    expect(lockPiece(p, 0)).toMatchObject({ spin: 'mini', lines: 2, attack: 1 });
  });
  it('requires 3 corners and a rotation; the fifth kick upgrades Mini', () => {
    const p = createPlayer(1, 2);
    p.board = emptyBoard();
    p.active = { type: 'T', x: 3, y: 10, rotation: 0 };
    p.rotationKick = 1;
    p.board[HIDDEN + 12][3] = 'G';
    p.board[HIDDEN + 12][5] = 'G';
    expect(detectSpin(p)).toBe('none');
    p.board[HIDDEN + 10][3] = 'G';
    expect(detectSpin(p)).toBe('mini');
    p.rotationKick = 5;
    expect(detectSpin(p)).toBe('full');
    p.rotationKick = null;
    expect(detectSpin(p)).toBe('none');
  });
  it('uses 13+ REN for five extra lines; fourteen singles total 37', () => {
    expect([11, 12, 13, 99].map(renBonus)).toEqual([4, 4, 5, 5]);
    expect(
      Array.from({ length: 14 }, (_, ren) => calculateAttack(1, 'none', false, false, ren)).reduce(
        (a, b) => a + b,
        0,
      ),
    ).toBe(37);
  });
  it('keeps B2B through non-clears but resets REN, and a normal single breaks B2B', () => {
    const p = createPlayer(1, 2);
    tetrisFixture(p);
    lockPiece(p, 0);
    expect(p.b2b).toBe(true);
    p.active = { type: 'O', x: 6, y: 18, rotation: 0 };
    lockPiece(p, 1);
    expect(p.b2b).toBe(true);
    expect(p.ren).toBe(-1);
    tetrisFixture(p);
    expect(lockPiece(p, 2).attack).toBe(5);
    p.board = emptyBoard();
    fill(p, 19, [4, 5]);
    p.active = { type: 'O', x: 3, y: 18, rotation: 0 };
    lockPiece(p, 3);
    expect(p.b2b).toBe(false);
  });
  it('PC replaces the full attack with 10 even with B2B and high REN', () => {
    expect(calculateAttack(4, 'none', true, true, 13)).toBe(10);
    const p = createPlayer(1, 2);
    for (let y = 16; y < 20; y++) fill(p, y, [4]);
    p.active = { type: 'I', x: 2, y: 16, rotation: 1 };
    p.b2b = true;
    p.ren = 13;
    expect(lockPiece(p, 0)).toMatchObject({ perfect: true, attack: 10 });
    expect(p.b2b).toBe(true);
  });
  it('all basic attacks match the design', () => {
    expect([1, 2, 3, 4].map((n) => calculateAttack(n, 'none', false, false, 0))).toEqual([
      0, 1, 2, 4,
    ]);
    expect([1, 2, 3].map((n) => calculateAttack(n, 'full', false, true, 0))).toEqual([3, 5, 7]);
    expect(calculateAttack(0, 'full', false, true, 10)).toBe(0);
  });
});

describe('versus / garbage / top-out', () => {
  it.each([0, 1] as const)(
    'reduces only seat %i on every clear, including bonuses and perfect clears',
    (seat) => {
      for (const lines of [1, 2, 3] as const) {
        const m = createMatch('versus', 5);
        m.phase = 'playing';
        const handicap: Handicap = { seat, lines };
        for (let clear = 0; clear < 3; clear++) {
          m.players.forEach((p) => {
            tetrisFixture(p);
            p.incoming = [];
            if (clear === 2) p.board[HIDDEN + 10][0] = null;
          });
          const before = m.players.map((p) => p.stats.sent);
          stepMatch(m, [press(Button.hard), press(Button.hard)], RULES, undefined, handicap);
          const attack = [4, 5, 10][clear];
          for (let i = 0; i < 2; i++) {
            const expected = attack - (i === seat ? lines : 0);
            expect(m.players[i].stats.sent - before[i]).toBe(expected);
            expect(m.players[1 - i].incoming[0].lines).toBe(expected);
          }
        }
      }
    },
  );

  it.each([0, 1, 3, 5])(
    'preserves cancellation of %i incoming lines and clamps handicap attacks to zero',
    (incoming) => {
      const m = createMatch('versus', 5);
      m.phase = 'playing';
      tetrisFixture(m.players[0]);
      if (incoming) m.players[0].incoming = [{ id: 1, eligibleTick: 0, lines: incoming }];
      stepMatch(m, [press(Button.hard), NO_INPUT], RULES, undefined, { seat: 0, lines: 3 });
      expect(m.players[0].stats.cancelled).toBe(Math.min(4, incoming));
      const sent = Math.max(0, 4 - incoming - 3);
      expect(m.players[0].stats.sent).toBe(sent);
      expect(m.players[1].incoming.reduce((n, g) => n + g.lines, 0)).toBe(sent);
      if (!sent) expect(m.players[1].incoming).toEqual([]);
    },
  );

  it('keeps zero-attack clears at zero and ignores handicaps in solo modes', () => {
    for (const mode of ['practice', 'sprint', 'versus'] as const) {
      const m = createMatch(mode, 5);
      m.phase = 'playing';
      const p = m.players[0];
      fill(p, 19, [4, 5]);
      p.active = { type: 'O', x: 3, y: 18, rotation: 0 };
      stepMatch(m, [press(Button.hard), NO_INPUT], RULES, undefined, { seat: 0, lines: 3 });
      expect(p.stats.sent).toBe(0);
      tetrisFixture(p);
      stepMatch(m, [press(Button.hard), NO_INPUT], RULES, undefined, { seat: 0, lines: 3 });
      expect(p.stats.sent).toBe(mode === 'versus' ? 1 : 4);
    }
  });

  it('cancels FIFO, including attacks that are not yet eligible to rise', () => {
    const p = createPlayer(1, 2);
    p.incoming = [
      { id: 1, eligibleTick: 100, lines: 2 },
      { id: 2, eligibleTick: 100, lines: 4 },
    ];
    expect(cancelGarbage(p, 5)).toBe(0);
    expect(p.incoming.map((i) => i.lines)).toEqual([1]);
    expect(p.stats.cancelled).toBe(5);
  });
  it('caps each rise at 8 with exactly one hole per line, then starts a new batch', () => {
    const p = createPlayer(1, 2);
    p.incoming = [{ id: 1, eligibleTick: 30, lines: 12 }];
    expect(receiveGarbage(p, 29)).toBe(0);
    expect(receiveGarbage(p, 30)).toBe(8);
    expect(p.incoming[0].lines).toBe(4);
    expect(p.board.slice(-8).every((row) => row.filter((c) => c === null).length === 1)).toBe(true);
    expect(receiveGarbage(p, 31)).toBe(4);
  });
  it('a zero-attack Single blocks incoming garbage', () => {
    const m = createMatch('versus', 5);
    m.phase = 'playing';
    const p = m.players[0];
    fill(p, 19, [4, 5]);
    p.active = { type: 'O', x: 3, y: 18, rotation: 0 };
    p.incoming.push({ id: 1, eligibleTick: 0, lines: 5 });
    stepMatch(m, [press(Button.hard), NO_INPUT]);
    expect(p.stats.received).toBe(0);
    expect(p.incoming[0].lines).toBe(5);
  });
  it('simultaneous Tetrises send four each instead of favoring the first player', () => {
    const m = createMatch('versus', 5);
    m.phase = 'playing';
    m.players.forEach(tetrisFixture);
    stepMatch(m, [press(Button.hard), press(Button.hard)]);
    expect(m.players.map((p) => p.stats.sent)).toEqual([4, 4]);
    expect(m.players.map((p) => p.incoming[0].lines)).toEqual([4, 4]);
  });
  it('only surplus is sent; a non-clear lock takes ready garbage', () => {
    const m = createMatch('versus', 5);
    m.phase = 'playing';
    tetrisFixture(m.players[0]);
    m.players[0].incoming = [{ id: 1, eligibleTick: 0, lines: 3 }];
    m.players[1].incoming = [{ id: 2, eligibleTick: 0, lines: 2 }];
    stepMatch(m, [press(Button.hard), press(Button.hard)]);
    expect(m.players[0].stats.sent).toBe(1);
    expect(m.players[1].stats.received).toBe(2);
    expect(m.players[1].incoming[0].lines).toBe(1);
  });
  it('HOLD spawn collisions lose, while partial lock out survives', () => {
    const p = createPlayer(1, 2);
    p.hold = 'O';
    p.board[HIDDEN - 2][4] = 'G';
    stepPlayer(p, press(Button.hold), 0);
    expect(p.dead).toBe(true);
    const partial = createPlayer(1, 2);
    partial.active = { type: 'O', x: 3, y: -1, rotation: 0 };
    lockPiece(partial, 0);
    expect(partial.dead).toBe(false);
  });
  it('full lock out loses, line clears rescue hidden cells, overflow loses', () => {
    const p = createPlayer(1, 2);
    p.active = { type: 'O', x: 3, y: -3, rotation: 0 };
    lockPiece(p, 0);
    expect(p.dead).toBe(true);
    const rescued = createPlayer(1, 2);
    fill(rescued, -1, [4, 5]);
    rescued.active = { type: 'O', x: 3, y: -2, rotation: 0 };
    lockPiece(rescued, 0);
    expect(rescued.dead).toBe(false);
    const overflow = createPlayer(1, 2);
    overflow.board[0][0] = 'G';
    overflow.incoming = [{ id: 1, lines: 1, eligibleTick: 0 }];
    receiveGarbage(overflow, 0);
    expect(overflow.dead).toBe(true);
  });
  it('two wins end the match; round resets leave the monotonic tick intact', () => {
    const m = createMatch('versus', 5);
    m.phase = 'playing';
    m.players[1].dead = true;
    stepMatch(m);
    expect(m.wins).toEqual([1, 0]);
    expect(m.phase).toBe('roundOver');
    const tick = m.tick;
    nextRound(m);
    expect(m.tick).toBe(tick);
    expect(m.players[1].dead).toBe(false);
    expect(m.round).toBe(2);
    m.phase = 'playing';
    m.players[1].dead = true;
    stepMatch(m);
    expect(m.phase).toBe('finished');
    expect(m.wins).toEqual([2, 0]);
  });
  it('simultaneous losses draw and practice never advances the second board', () => {
    const m = createMatch('versus', 5);
    m.phase = 'playing';
    m.players.forEach((p) => (p.dead = true));
    stepMatch(m);
    expect(m.winner).toBeNull();
    expect(m.wins).toEqual([0, 0]);
    const practice = createMatch('practice', 5);
    practice.phase = 'playing';
    const before = JSON.stringify(practice.players[1]);
    stepMatch(practice, [NO_INPUT, press(Button.hard)]);
    expect(JSON.stringify(practice.players[1])).toBe(before);
  });
});

describe('replay', () => {
  it('replays older recordings with their original entry and clear delays', () => {
    const rules = { ...RULES, version: 'ppt2-vs-draft-1', entryDelay: 6, clearDelay: 30 };
    const match = createMatch('practice', 9, rules);
    const replay = newReplay('practice', 9);
    replay.rulesVersion = rules.version;
    for (let i = 0; i < 400 && match.phase !== 'finished'; i++) {
      const inputs: [Input, Input] = [i % 3 === 0 ? press(Button.hard) : NO_INPUT, NO_INPUT];
      recordTick(replay, inputs);
      stepMatch(match, inputs, rules);
    }
    replay.finalHash = stateHash(match);
    const player = new ReplayPlayer(parseReplay(JSON.stringify(replay)));
    while (!player.done) player.step();
    expect(player.valid).toBe(true);
    expect(player.match).toEqual(match);
  });
  it('replays a complete first-to-two match including the round transition', () => {
    const match = createMatch('versus', 123);
    const replay = newReplay('versus', 123);
    for (let i = 0; i < 3000 && match.phase !== 'finished'; i++) {
      if (match.phase === 'roundOver') {
        nextRound(match);
        replay.rounds.push([]);
      }
      const inputs: [Input, Input] = [i % 12 === 0 ? press(Button.hard) : NO_INPUT, NO_INPUT];
      recordTick(replay, inputs);
      stepMatch(match, inputs);
    }
    expect(match.phase).toBe('finished');
    expect(match.wins).toEqual([0, 2]);
    expect(replay.rounds).toHaveLength(2);
    replay.finalHash = stateHash(match);
    const player = new ReplayPlayer(parseReplay(JSON.stringify(replay)));
    while (!player.done) player.step();
    expect(player.valid).toBe(true);
    expect(player.match).toEqual(match);
  });
  it('records a full round and reproduces every final-state field', () => {
    const match = createMatch('practice', 9);
    const replay = newReplay('practice', 9);
    for (let i = 0; i < 3000 && match.phase !== 'finished'; i++) {
      const inputs: [Input, Input] = [i % 15 === 0 ? press(Button.hard) : NO_INPUT, NO_INPUT];
      recordTick(replay, inputs);
      stepMatch(match, inputs);
    }
    replay.finalHash = stateHash(match);
    const player = new ReplayPlayer(parseReplay(JSON.stringify(replay)));
    while (!player.done) player.step();
    expect(player.valid).toBe(true);
    expect(player.match).toEqual(match);
  });
  it('rejects corrupt, unsupported and excessively long input files', () => {
    expect(() => parseReplay('{}')).toThrow();
    const replay = newReplay('practice', 1);
    replay.finalHash = '00000000';
    replay.rounds = [[{ ticks: 999_999_999, inputs: [NO_INPUT, NO_INPUT] }]];
    expect(() => parseReplay(JSON.stringify(replay))).toThrow();
    replay.rounds = [[{ ticks: 1, inputs: [{ held: -1, pressed: 0 }, NO_INPUT] }]];
    expect(() => parseReplay(JSON.stringify(replay))).toThrow();
  });
});
