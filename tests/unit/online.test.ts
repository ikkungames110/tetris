import { describe, expect, it } from 'vitest';
import { Rooms, type Peer } from '../../packages/network/rooms';
import { createMatch } from '../../packages/core/engine';
import {
  handshake,
  parseClientMessage,
  parseServerMessage,
  publicMatch,
  type RoomState,
  type ServerMessage,
} from '../../packages/protocol/online';
import { Button } from '../../packages/core/types';

class Client implements Peer {
  messages: ServerMessage[] = [];
  send(message: ServerMessage) {
    this.messages.push(structuredClone(message));
  }
  get room(): RoomState {
    return [...this.messages].reverse().find((m) => m.type === 'room') as RoomState;
  }
  get joined() {
    return this.messages.find((m) => m.type === 'joined')! as Extract<
      ServerMessage,
      { type: 'joined' }
    >;
  }
  get last() {
    return this.messages.at(-1);
  }
}
function setup() {
  let now = 1000;
  const rooms = new Rooms(
    () => now,
    () => 1234,
  );
  const a = new Client(),
    b = new Client();
  rooms.handle(a, { type: 'create', ...handshake });
  rooms.handle(b, { type: 'join', code: a.joined.code, ...handshake });
  const ready = (client: Client) =>
    rooms.handle(client, {
      type: 'ready',
      matchId: client.room.matchId,
      round: client.room.match?.round ?? 0,
    });
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      now += 1000 / 60;
      rooms.tick();
    }
  };
  const start = () => {
    ready(a);
    ready(b);
    tick(180);
  };
  let seq = 0;
  const input = (client: Client, pressed: number, held = 0) =>
    rooms.handle(client, {
      type: 'input',
      matchId: client.room.matchId,
      round: client.room.match!.round,
      seq: ++seq,
      input: { held, pressed },
    });
  return {
    rooms,
    a,
    b,
    ready,
    tick,
    start,
    input,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('online protocol', () => {
  it('accepts public snapshots and rejects malformed peer data before rendering', () => {
    const message: RoomState = {
      type: 'room',
      code: 'ABC234',
      matchId: 'test',
      connected: [true, true],
      ready: [false, false],
      match: publicMatch(createMatch('versus', 42)),
    };
    expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
    for (const mutate of [
      (m: RoomState) => {
        m.match!.players[0].board = [];
      },
      (m: RoomState) => {
        m.match!.players[0].active!.rotation = 7 as never;
      },
      (m: RoomState) => {
        m.match!.players[0].next = [];
      },
      (m: RoomState) => {
        m.match!.players[0].stats = null as never;
      },
      (m: RoomState) => {
        m.match!.players[0].incoming = [null as never];
      },
    ]) {
      const invalid = structuredClone(message);
      mutate(invalid);
      expect(parseServerMessage(JSON.stringify(invalid))).toBeNull();
    }
    expect(parseServerMessage('null')).toBeNull();
    expect(parseServerMessage('{')).toBeNull();
  });
  it('rejects incompatible versions, malformed payloads and non-game input bits', () => {
    for (const value of [
      null,
      [],
      {},
      { type: 'create', ...handshake, version: 999 },
      { type: 'join', ...handshake, code: '../etc' },
      { type: 'input', matchId: 'm', round: 1, seq: 1, input: { held: 128, pressed: 0 } },
      { type: 'input', matchId: 'm', round: 1, seq: -1, input: { held: 0, pressed: 0 } },
    ]) {
      expect(parseClientMessage(JSON.stringify(value))).toBeNull();
    }
    expect(parseClientMessage('{')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'create', ...handshake }))).not.toBeNull();
  });
});

describe('authoritative rooms', () => {
  it('requires both players ready, rejects a third seat and hides private randomness', () => {
    const { rooms, a, b, ready, tick } = setup();
    const third = new Client();
    rooms.handle(third, { type: 'join', code: a.joined.code, ...handshake });
    expect(third.last?.type).toBe('error');
    ready(a);
    tick(10);
    expect(a.room.match).toBeNull();
    ready(b);
    tick(180);
    expect(a.room.match?.phase).toBe('playing');
    expect(a.room).toEqual(b.room);
    expect(a.room.match).not.toHaveProperty('seed');
    expect(a.room.match).not.toHaveProperty('roundSeed');
    expect(a.room.match?.players[0]).not.toHaveProperty('bag');
    expect(a.room.match?.players[0]).not.toHaveProperty('garbageRng');
    expect(a.room.match?.players[0].next).toHaveLength(5);
  });

  it('applies inputs only to the owning seat, ignores duplicate and stale input, expires held keys', () => {
    const { rooms, a, b, start, input, tick } = setup();
    start();
    const message = {
      type: 'input' as const,
      matchId: a.room.matchId,
      round: 1,
      seq: 1,
      input: { held: 0, pressed: Button.hard },
    };
    rooms.handle(a, message);
    tick(3);
    rooms.handle(a, message);
    tick(3);
    rooms.handle(a, { ...message, seq: 2, round: 0 });
    tick(3);
    rooms.handle(a, { ...message, seq: 3, matchId: 'old-match' });
    tick(3);
    expect(a.room.match?.players.map((p) => p.stats.pieces)).toEqual([1, 0]);
    input(b, Button.left, Button.left);
    tick(21);
    const x = b.room.match!.players[1].active!.x;
    tick(30);
    expect(b.room.match!.players[1].active!.x).toBe(x);
    expect(a.room).toEqual(b.room);
  });

  it('preserves distinct quick presses in order without repeating edges on missing ticks', () => {
    const { a, start, input, tick } = setup();
    start();
    input(a, Button.hard);
    input(a, 0);
    input(a, Button.hard);
    tick(6);
    expect(a.room.match?.players[0].stats.pieces).toBe(2);
    tick(30);
    expect(a.room.match?.players[0].stats.pieces).toBe(2);
  });

  it('runs two rounds, agrees on the winner and starts a fresh match only after both accept', () => {
    const { a, b, start, ready, input, tick } = setup();
    start();
    const id = a.room.matchId;
    for (let round = 1; round <= 2; round++) {
      for (let i = 0; i < 30 && a.room.match?.phase === 'playing'; i++) {
        input(a, Button.hard);
        tick(3);
      }
      expect(a.room.match?.winner).toBe(1);
      expect(a.room.match?.wins).toEqual([0, round]);
      expect(a.room).toEqual(b.room);
      ready(a);
      tick(3);
      expect(a.room.match?.phase).toBe(round === 1 ? 'roundOver' : 'finished');
      ready(b);
      tick(180);
    }
    expect(a.room.matchId).not.toBe(id);
    expect(a.room.match?.round).toBe(1);
    expect(a.room.match?.wins).toEqual([0, 0]);
    expect(a.room.match?.phase).toBe('playing');
  });

  it('keeps ticking after disconnect and restores the same seat with its secret token', () => {
    const { rooms, a, b, start, tick } = setup();
    start();
    rooms.disconnect(a);
    const initialTick = b.room.match!.tick;
    tick(60);
    expect(b.room.match!.tick).toBeGreaterThan(initialTick);
    const attacker = new Client();
    rooms.handle(attacker, {
      type: 'resume',
      ...handshake,
      code: a.joined.code,
      token: '0'.repeat(48),
    });
    expect(attacker.last?.type).toBe('error');
    const resumed = new Client();
    rooms.handle(resumed, {
      type: 'resume',
      ...handshake,
      code: a.joined.code,
      token: a.joined.token,
    });
    expect(resumed.joined.seat).toBe(0);
    expect(resumed.room).toEqual(b.room);
    expect(resumed.room.connected).toEqual([true, true]);
  });

  it('awards a disconnect forfeit, invalidates a double disconnect and closes waiting rooms', () => {
    for (const both of [false, true]) {
      const { rooms, a, b, start, advance, tick } = setup();
      start();
      rooms.disconnect(a);
      if (both) rooms.disconnect(b);
      advance(10_000);
      tick();
      if (!both) expect(b.last).toMatchObject({ type: 'closed', winner: 1 });
      const resumed = new Client();
      rooms.handle(resumed, {
        type: 'resume',
        ...handshake,
        code: a.joined.code,
        token: a.joined.token,
      });
      expect(resumed.last?.type).toBe('error');
    }
    const { rooms, a, b } = setup();
    rooms.handle(a, { type: 'leave' });
    expect(b.last).toMatchObject({ type: 'closed', winner: null });
  });

  it('invalidates matches on server shutdown', () => {
    const { rooms, a, start } = setup();
    start();
    rooms.shutdown();
    expect(a.last).toMatchObject({ type: 'closed', winner: null });
  });
});
