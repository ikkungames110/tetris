import { describe, expect, it } from 'vitest';
import { Rooms, type Peer } from '../../packages/network/rooms';
import { createMatch } from '../../packages/core/engine';
import {
  encodeServerMessage,
  handshake,
  parseClientMessage,
  parseServerMessage,
  publicMatch,
  type RoomState,
  type RoomOptions,
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
function setup(options?: RoomOptions) {
  let now = 1000;
  const rooms = new Rooms(
    () => now,
    () => 1234,
  );
  const a = new Client(),
    b = new Client();
  rooms.handle(a, { type: 'create', ...handshake, options });
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
      winsRequired: 3,
      names: ['ゲスト', 'ゲスト'],
      kind: 'private',
      handicap: null,
      code: 'ABC234',
      matchId: 'test',
      connected: [true, true],
      ready: [false, false],
      ack: [0, 0],
      nextRoundIn: null,
      match: publicMatch(createMatch('versus', 42)),
    };
    expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
    expect(parseServerMessage(encodeServerMessage(message))).toEqual(message);
    // Even at 30Hz the packed snapshots use less bandwidth than the old 20Hz JSON boards.
    expect(encodeServerMessage(message).length * 30).toBeLessThan(
      JSON.stringify(message).length * 20,
    );
    const invalidBoard = JSON.parse(encodeServerMessage(message));
    invalidBoard.match.players[0].board = '.'.repeat(399);
    expect(parseServerMessage(JSON.stringify(invalidBoard))).toBeNull();
    for (const mutate of [
      (m: RoomState) => {
        m.winsRequired = 0;
      },
      (m: RoomState) => {
        m.names = ['ゲスト', 'x'.repeat(41)];
      },
      (m: RoomState) => {
        m.match!.wins = [4, 0];
      },
      (m: RoomState) => {
        m.handicap = { seat: 2, lines: 3 } as never;
      },
      (m: RoomState) => {
        m.kind = 'random';
        m.handicap = { seat: 0, lines: 1 };
      },
      (m: RoomState) => {
        m.match!.players[0].fallTicks = -1;
      },
      (m: RoomState) => {
        m.match!.players[0].board = [];
      },
      (m: RoomState) => {
        m.match!.players[0].active!.rotation = 7 as never;
      },
      (m: RoomState) => {
        m.match!.players[0].active!.y = 39;
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
      ...[0, 10, 1.5, '3'].map((winsRequired) => ({
        type: 'create',
        ...handshake,
        options: { kind: 'private', handicap: null, winsRequired },
      })),
      {
        type: 'create',
        ...handshake,
        options: { kind: 'random', handicap: null, winsRequired: 2 },
      },
      { type: 'join', ...handshake, code: 'ABC234', name: 'x'.repeat(41) },
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

describe('room handicap protocol', () => {
  it('accepts each private handicap and rejects invalid or random handicaps', () => {
    for (const seat of [0, 1])
      for (const lines of [1, 2, 3]) {
        const options = { kind: 'private', handicap: { seat, lines } };
        expect(
          parseClientMessage(JSON.stringify({ type: 'create', ...handshake, options })),
        ).toMatchObject({ options });
      }
    for (const options of [
      null,
      { kind: 'private', handicap: { seat: 2, lines: 1 } },
      ...[-1, 0, 4, 1.5, '2'].map((lines) => ({ kind: 'private', handicap: { seat: 0, lines } })),
      { kind: 'random', handicap: { seat: 1, lines: 3 } },
      { kind: 'unknown', handicap: null },
    ]) {
      expect(
        parseClientMessage(JSON.stringify({ type: 'create', ...handshake, options })),
      ).toBeNull();
    }
  });

  it('publishes the handicap to both seats and preserves it across rounds, rematches and reconnects', () => {
    const options: RoomOptions = {
      kind: 'private',
      handicap: { seat: 1, lines: 3 },
      winsRequired: 2,
    };
    const { rooms, a, b, start, ready, input, tick } = setup(options);
    expect(a.room).toMatchObject(options);
    expect(b.room).toMatchObject(options);
    expect(parseServerMessage(encodeServerMessage(b.room))).toEqual(b.room);
    start();
    for (let round = 1; round <= 2; round++) {
      for (let i = 0; i < 30 && a.room.match?.phase === 'playing'; i++) {
        input(a, Button.hard);
        tick(3);
      }
      if (round === 2) {
        expect(a.room.match?.phase).toBe('finished');
        ready(a);
        ready(b);
      }
      tick(365);
      expect(a.room).toMatchObject(options);
      expect(a.room).toEqual(b.room);
      expect(a.room.match?.phase).toBe('playing');
    }
    expect(a.room.match?.round).toBe(1);
    rooms.disconnect(b);
    const resumed = new Client();
    rooms.handle(resumed, {
      type: 'resume',
      ...handshake,
      code: b.joined.code,
      token: b.joined.token,
    });
    expect(resumed.room).toMatchObject(options);
  });

  it('keeps random rooms free of handicaps even for direct host calls', () => {
    const { a } = setup({ kind: 'random', handicap: { seat: 0, lines: 3 } });
    expect(a.room).toMatchObject({ kind: 'random', handicap: null });
  });
});

describe('authoritative rooms', () => {
  it('immediately forfeits either random seat on disconnect, including between rounds', () => {
    for (const seat of [0, 1]) {
      const { rooms, a, b, start } = setup({ kind: 'random', handicap: null });
      start();
      rooms.disconnect(seat === 0 ? a : b);
      expect((seat === 0 ? b : a).last).toMatchObject({ type: 'closed', winner: 1 - seat });
    }
    const { rooms, a, b, start, input, tick } = setup({ kind: 'random', handicap: null });
    start();
    for (let i = 0; i < 30 && a.room.match?.phase === 'playing'; i++) {
      input(a, Button.hard);
      tick(3);
    }
    expect(a.room.match?.phase).toBe('roundOver');
    rooms.disconnect(b);
    expect(a.last).toMatchObject({ type: 'closed', winner: 0 });
  });
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

  it.each([1, 3, 5, 9])(
    'plays first to %i, then keeps the room until both players ready again',
    (winsRequired) => {
      const { a, b, start, ready, input, tick, advance } = setup({
        kind: 'private',
        handicap: null,
        winsRequired,
      });
      start();
      const id = a.room.matchId;
      const code = a.room.code;
      for (let round = 1; round <= winsRequired; round++) {
        for (let i = 0; i < 30 && a.room.match?.phase === 'playing'; i++) {
          input(a, Button.hard);
          tick(3);
        }
        expect(a.room.match?.winner).toBe(1);
        expect(a.room.match?.wins).toEqual([0, round]);
        expect(a.room).toEqual(b.room);
        expect(parseServerMessage(encodeServerMessage(a.room))).toEqual(a.room);
        if (round < winsRequired) {
          ready(a);
          expect(a.room.ready).toEqual([false, false]);
          tick(120);
          expect(a.room.match?.phase).toBe('roundOver');
          tick(65);
          expect(a.room.match?.phase).toBe('countdown');
          expect(a.room.ack).toEqual([0, 0]);
          tick(180);
        }
      }
      expect(a.room.match?.phase).toBe('finished');
      expect(a.room.nextRoundIn).toBeNull();
      advance(60 * 60_000);
      tick();
      expect(a.last?.type).not.toBe('closed');
      expect(a.room.matchId).toBe(id);
      ready(a);
      tick(360);
      expect(a.room.ready).toEqual([true, false]);
      expect(a.room.match?.phase).toBe('finished');
      ready(b);
      expect(a.room.code).toBe(code);
      expect(a.room.matchId).not.toBe(id);
      expect(a.room.match?.round).toBe(1);
      expect(a.room.match?.wins).toEqual([0, 0]);
      expect(a.room.ready).toEqual([false, false]);
      tick(180);
      expect(a.room.match?.phase).toBe('playing');
    },
  );

  it('always requires three random wins and never automatically rematches', () => {
    const { a, b, start, input, tick, ready } = setup({
      kind: 'random',
      handicap: null,
      winsRequired: 1,
    });
    expect(a.room.winsRequired).toBe(3);
    start();
    for (let round = 1; round <= 3; round++) {
      for (let i = 0; i < 30 && a.room.match?.phase === 'playing'; i++) {
        input(a, Button.hard);
        tick(3);
      }
      expect(a.room.match?.wins).toEqual([0, round]);
      expect(a.room.match?.phase).toBe(round < 3 ? 'roundOver' : 'finished');
      tick(365);
    }
    const id = a.room.matchId;
    ready(a);
    ready(b);
    tick(365);
    expect(a.room.matchId).toBe(id);
    expect(a.room.match?.phase).toBe('finished');
  });

  it('keeps connected waiting players regardless of inactivity', () => {
    const { a, b, ready, tick, advance } = setup();
    ready(a);
    advance(24 * 60 * 60_000);
    tick();
    expect(a.last?.type).not.toBe('closed');
    ready(b);
    expect(a.room.match?.phase).toBe('countdown');
  });

  it('pauses automatic progression while disconnected and grants a fresh countdown on resume', () => {
    const { rooms, a, b, start, input, tick } = setup();
    start();
    for (let i = 0; i < 30 && a.room.match?.phase === 'playing'; i++) {
      input(a, Button.hard);
      tick(3);
    }
    rooms.disconnect(b);
    tick(240);
    expect(a.room.match?.phase).toBe('roundOver');
    expect(a.room.nextRoundIn).toBeNull();
    const resumed = new Client();
    rooms.handle(resumed, {
      type: 'resume',
      ...handshake,
      code: b.joined.code,
      token: b.joined.token,
    });
    tick(2);
    expect(a.room.nextRoundIn).toBe(3);
    tick(120);
    expect(a.room.match?.phase).toBe('roundOver');
    tick(62);
    expect(a.room.match?.phase).toBe('countdown');
  });

  it('acknowledges consumed inputs and catches up redundant held frames without losing presses', () => {
    const { a, start, input, tick } = setup();
    start();
    for (let i = 0; i < 12; i++) input(a, 0);
    input(a, Button.hard);
    input(a, Button.hard);
    tick(4);
    expect(a.room.ack[0]).toBe(14);
    expect(a.room.match?.players[0].stats.pieces).toBe(2);
    tick(30);
    expect(a.room.match?.players[0].stats.pieces).toBe(2);
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
