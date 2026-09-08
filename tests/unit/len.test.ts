import { expect, it } from 'vitest';
import { createMatch, stateHash, stepMatch } from '../../packages/core/engine';
import { Button, NO_INPUT, RULES } from '../../packages/core/types';
import {
  encodeServerMessage,
  parseServerMessage,
  publicMatch,
  type RoomState,
} from '../../packages/protocol/online';

it('carries consecutive-clear counts to audio and peers, resets on a non-clear, and preserves legacy hashes', () => {
  const match = createMatch('practice', 42);
  match.phase = 'playing';
  const player = match.players[0];
  for (const expected of [0, 1, 2, 3]) {
    player.board = Array.from({ length: 40 }, () => Array(10).fill(null));
    player.board[39] = Array.from({ length: 10 }, (_, x) => (x >= 3 && x <= 6 ? null : 'J'));
    player.active = { type: 'I', x: 3, y: 16, rotation: 0 };
    player.wait = 0;
    stepMatch(match, [{ held: 0, pressed: Button.hard }, NO_INPUT], RULES);
    expect(player.ren).toBe(expected);
    expect(match.events[0]).toMatchObject({ type: 'clear', ren: expected });
    const legacy = structuredClone(match);
    for (const event of legacy.events) delete event.ren;
    expect(stateHash(match)).toBe(stateHash(legacy));
  }
  match.mode = 'versus';
  const room: RoomState = {
    type: 'room',
    kind: 'private',
    handicap: null,
    code: 'ABC234',
    matchId: 'test',
    connected: [true, true],
    ready: [true, true],
    ack: [0, 0],
    nextRoundIn: null,
    match: publicMatch(match),
  };
  const decoded = parseServerMessage(encodeServerMessage(room));
  expect(decoded).toEqual(room);
  room.match!.events[0].ren = -1;
  expect(parseServerMessage(encodeServerMessage(room))).toBeNull();
  room.match!.events[0].ren = Infinity;
  expect(parseServerMessage(encodeServerMessage(room))).toBeNull();
  player.board = Array.from({ length: 40 }, () => Array(10).fill(null));
  player.active = { type: 'O', x: 3, y: 16, rotation: 0 };
  player.wait = 0;
  stepMatch(match, [{ held: 0, pressed: Button.hard }, NO_INPUT], RULES);
  expect(player.ren).toBe(-1);
  expect(match.events[0]).toMatchObject({ type: 'lock' });
  expect(match.events[0].ren).toBeUndefined();
});
