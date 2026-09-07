import { expect, it } from 'vitest';
import { createMatch, stateHash, stepMatch } from '../../packages/core/engine';
import { cells } from '../../packages/core/pieces';
import { Button, NO_INPUT, type Match } from '../../packages/core/types';
import {
  encodeServerMessage,
  parseServerMessage,
  publicMatch,
  type RoomState,
} from '../../packages/protocol/online';

function legacyHash(match: Match): string {
  const old = structuredClone(match);
  delete old.rotationSounds;
  for (const event of old.events) {
    delete event.spin;
    delete event.perfect;
  }
  const json = JSON.stringify(old);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

it('reports only successful rotations, classifies T-spin at rotation time and preserves hashes', () => {
  const match = createMatch('practice', 42);
  match.phase = 'playing';
  const player = match.players[0];
  player.active = { type: 'T', x: 3, y: 17, rotation: 1 };
  player.board[37][3] = 'J';
  player.board[39][3] = 'J';
  player.board[39][5] = 'J';
  stepMatch(match, [{ held: 0, pressed: Button.cw }, NO_INPUT]);
  expect(match.rotationSounds).toEqual([{ tick: 1, player: 0, spin: 'full' }]);
  expect(match.events).toEqual([]);
  expect(match.eventId).toBe(0);
  expect(stateHash(match)).toBe(legacyHash(match));
  stepMatch(match, [NO_INPUT, NO_INPUT]);
  expect(match.rotationSounds).toBeUndefined();
  player.board = player.board.map((row) => row.map(() => null));
  player.active = { type: 'T', x: 3, y: 5, rotation: 0 };
  stepMatch(match, [{ held: 0, pressed: Button.ccw }, NO_INPUT]);
  expect(match.rotationSounds?.[0].spin).toBe('none');
  // Leave exactly the active T's four cells open, so all SRS rotation candidates fail.
  player.board = player.board.map((row) => row.map(() => 'G'));
  for (const [x, y] of cells(player.active!)) player.board[y + 20][x] = null;
  stepMatch(match, [{ held: 0, pressed: Button.cw }, NO_INPUT]);
  expect(match.rotationSounds).toBeUndefined();
  expect(stateHash(match)).toBe(legacyHash(match));
});

it('carries Perfect clear and both players rotations in validated snapshots without changing replay hashes', () => {
  const match = createMatch('versus', 42);
  match.phase = 'playing';
  const player = match.players[0];
  for (let y = 36; y < 40; y++)
    player.board[y] = Array.from({ length: 10 }, (_, x) => (x === 4 ? null : 'J'));
  player.active = { type: 'I', x: 2, y: 12, rotation: 0 };
  stepMatch(match, [
    { held: 0, pressed: Button.cw | Button.hard },
    { held: 0, pressed: Button.cw },
  ]);
  expect(match.events[0]).toMatchObject({ type: 'clear', amount: 4, perfect: true });
  expect(match.rotationSounds).toHaveLength(2);
  expect(stateHash(match)).toBe(legacyHash(match));
  const room: RoomState = {
    type: 'room',
    kind: 'private',
    handicap: null,
    code: 'ABCDEF',
    matchId: 'audio',
    connected: [true, true],
    ready: [true, true],
    ack: [1, 1],
    nextRoundIn: null,
    match: publicMatch(match),
  };
  expect(parseServerMessage(encodeServerMessage(room))).toEqual(room);
  const invalid = JSON.parse(encodeServerMessage(room));
  invalid.match.events[0].perfect = 'yes';
  expect(parseServerMessage(JSON.stringify(invalid))).toBeNull();
  for (const rotation of [
    { tick: 1, player: 2, spin: 'full' },
    { tick: 1, player: 0, spin: 'bad' },
    { tick: 2, player: 0, spin: 'none' },
  ]) {
    const copy = structuredClone(room);
    Object.assign(copy.match!, { rotationSounds: [rotation] });
    expect(parseServerMessage(encodeServerMessage(copy))).toBeNull();
  }
});
