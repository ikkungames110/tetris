import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createMatch, stateHash, stepMatch } from '../../packages/core/engine';
import { parseReplay, ReplayPlayer } from '../../packages/core/replay';
import { Button, NO_INPUT, RULES, type ClearEffect } from '../../packages/core/types';
import { PlayerPrediction } from '../../packages/network/prediction';
import { Rooms, type Peer } from '../../packages/network/rooms';
import {
  handshake,
  publicMatch,
  parseServerMessage,
  encodeServerMessage,
  type RoomState,
  type ServerMessage,
} from '../../packages/protocol/online';

it('captures original colors and row positions without changing deterministic match state', () => {
  const match = createMatch('versus', 42);
  match.phase = 'playing';
  for (let y = 36; y < 40; y++)
    match.players[0].board[y] = Array.from({ length: 10 }, (_, x) => (x === 4 ? null : 'J'));
  match.players[0].active = { type: 'I', x: 2, y: 16, rotation: 1 };
  const reference = structuredClone(match);
  const prediction = new PlayerPrediction();
  prediction.reconcile(publicMatch(match).players[0], 0, 0);
  const drop = { held: 0, pressed: Button.hard };
  let effect: ClearEffect | undefined;
  stepMatch(match, [drop, NO_INPUT], RULES, (_player, data) => (effect = data));
  stepMatch(reference, [drop, NO_INPUT]);
  expect(effect).toEqual({
    tick: 1,
    piece: 1,
    rows: [16, 17, 18, 19].map((y) => ({ y, cells: 'JJJJIJJJJJ' })),
  });
  expect(stateHash(match)).toBe(stateHash(reference));
  prediction.input(1, drop);
  expect(prediction.clearEffect).toEqual(effect);
});

it('preserves existing replay hashes when recording visual effects', () => {
  const replay = new ReplayPlayer(
    parseReplay(
      readFileSync(new URL('../fixtures/line-clear.replay.json', import.meta.url), 'utf8'),
    ),
  );
  const effects: ClearEffect[] = [];
  while (!replay.done) replay.step((_player, effect) => effects.push(effect));
  expect(replay.valid).toBe(true);
  expect(effects).toHaveLength(1);
  expect(effects[0].rows).toHaveLength(1);
});

it('delivers bounded clear geometry to the remote seat and rejects malformed visual data', () => {
  let now = 0;
  const rooms = new Rooms(
    () => now,
    () => 42,
  );
  const messages: ServerMessage[] = [];
  const a: Peer = { send: (m) => messages.push(structuredClone(m)) };
  const b: Peer = { send: (m) => messages.push(structuredClone(m)) };
  rooms.handle(a, { type: 'create', ...handshake });
  const joined = messages.find((m) => m.type === 'joined')!;
  if (joined.type !== 'joined') throw Error('Missing room');
  rooms.handle(b, { type: 'join', code: joined.code, ...handshake });
  const latest = () => [...messages].reverse().find((m) => m.type === 'room') as RoomState;
  const id = latest().matchId;
  for (const peer of [a, b]) rooms.handle(peer, { type: 'ready', matchId: id, round: 0 });
  const replay = parseReplay(
    readFileSync(new URL('../fixtures/line-clear.replay.json', import.meta.url), 'utf8'),
  );
  let seq = 0;
  for (const run of replay.rounds[0])
    for (let tick = 0; tick < run.ticks; tick++) {
      const room = latest();
      if (room.match?.phase === 'playing')
        rooms.handle(a, {
          type: 'input',
          matchId: room.matchId,
          round: 1,
          seq: ++seq,
          input: run.inputs[0],
        });
      now += 1000 / 60;
      rooms.tick();
    }
  const room = latest();
  expect(room.match!.players[0].clearEffect?.rows).toHaveLength(1);
  expect(parseServerMessage(encodeServerMessage(room))).toEqual(room);
  room.match!.players[0].clearEffect!.rows[0].cells = 'X'.repeat(1000);
  expect(parseServerMessage(encodeServerMessage(room))).toBeNull();
});

it('only labels T-spins, including a spin that also clears the board', async () => {
  const { clearLabel } = await import('../../apps/web/render');
  const player = createMatch('practice', 42).players[0];
  for (const lines of [1, 2, 3, 4]) {
    for (const perfect of [false, true]) {
      player.lastClear = { lines, spin: 'none', perfect, attack: 0, b2b: false, ren: 2 };
      player.lastClearTick = 10;
      expect(clearLabel(player, 10)).toBe('');
    }
  }
  player.lastClear = { lines: 2, spin: 'full', perfect: true, attack: 10, b2b: true, ren: 1 };
  expect(clearLabel(player, 10)).toBe('T-SPIN DOUBLE');
  player.lastClear.spin = 'mini';
  player.lastClear.lines = 1;
  expect(clearLabel(player, 10)).toBe('T-SPIN MINI SINGLE');
  player.lastClear.lines = 0;
  expect(clearLabel(player, 10)).toBe('T-SPIN MINI');
  expect(clearLabel(player, 161)).toBe('');
});

it('carries T-spin audio through snapshots while preserving legacy replay hashes', () => {
  const match = createMatch('practice', 42);
  match.phase = 'playing';
  const p = match.players[0];
  p.board[38] = Array.from({ length: 10 }, (_, x) => ([3, 4, 5].includes(x) ? null : 'J'));
  p.board[39] = Array.from({ length: 10 }, (_, x) => (x === 4 ? null : 'J'));
  p.board[37][3] = 'J';
  p.active = { type: 'T', x: 3, y: 17, rotation: 2 };
  p.rotationKick = 1;
  stepMatch(match, [{ held: 0, pressed: Button.hard }, NO_INPUT]);
  expect(match.events[0]).toMatchObject({ type: 'clear', amount: 2, spin: 'full' });
  expect(publicMatch(match).events[0]).toEqual(match.events[0]);
  const oldState = structuredClone(match);
  delete oldState.events[0].spin;
  let oldHash = 2166136261;
  const json = JSON.stringify(oldState);
  for (let i = 0; i < json.length; i++) oldHash = Math.imul(oldHash ^ json.charCodeAt(i), 16777619);
  expect(stateHash(match)).toBe((oldHash >>> 0).toString(16).padStart(8, '0'));
});
