import { createMatch, nextRound, stepMatch } from '../core/engine';
import { NO_INPUT, type Input, type Match } from '../core/types';
import {
  publicMatch,
  RECONNECT_MS,
  type ClientMessage,
  type ServerMessage,
} from '../protocol/online';

const randomInt = (min: number, max: number) => {
  const range = max - min;
  const limit = Math.floor(0x100000000 / range) * range;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= limit);
  return min + (value % range);
};
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');

export interface Peer {
  send(message: ServerMessage): void;
}
interface Seat {
  token: string;
  peer: Peer | null;
  disconnectedAt: number;
  ready: boolean;
  seq: number;
  inputAt: number;
  held: number;
  queue: Input[];
}
interface Room {
  code: string;
  matchId: string;
  seats: [Seat | null, Seat | null];
  match: Match | null;
  touchedAt: number;
}

export class Rooms {
  private rooms = new Map<string, Room>();
  private peers = new Map<Peer, { room: Room; seat: Seat; index: number }>();
  constructor(
    private now = Date.now,
    private seed = () => randomInt(1, 0xffffffff),
  ) {}

  private broadcast(room: Room): void {
    const message: ServerMessage = {
      type: 'room',
      code: room.code,
      matchId: room.matchId,
      connected: room.seats.map((s) => !!s?.peer) as [boolean, boolean],
      ready: room.seats.map((s) => !!s?.ready) as [boolean, boolean],
      match: room.match ? publicMatch(room.match) : null,
    };
    for (const seat of room.seats) seat?.peer?.send(message);
  }

  private close(room: Room, reason: string, winner: number | null): void {
    const peers = room.seats.flatMap((seat) => (seat?.peer ? [seat.peer] : []));
    this.rooms.delete(room.code);
    for (const peer of peers) this.peers.delete(peer);
    for (const peer of peers) peer.send({ type: 'closed', reason, winner });
  }

  handle(peer: Peer, message: ClientMessage): void {
    const fail = (message: string) => peer.send({ type: 'error', message });
    if (message.type === 'ping') {
      peer.send({ type: 'pong', time: message.time });
      return;
    }
    const membership = this.peers.get(peer);
    if (message.type === 'create' || message.type === 'join' || message.type === 'resume') {
      if (membership) return fail('すでにルームに参加しています。');
      let room: Room | undefined;
      let index = 0;
      if (message.type === 'create') {
        if (this.rooms.size >= 100)
          return fail('サーバーが満室です。しばらくしてからお試しください。');
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code: string;
        do {
          code = Array.from({ length: 6 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
        } while (this.rooms.has(code));
        room = {
          code,
          matchId: crypto.randomUUID(),
          seats: [null, null],
          match: null,
          touchedAt: this.now(),
        };
        this.rooms.set(code, room);
      } else {
        room = this.rooms.get(message.code);
        if (!room)
          return fail('ルームが見つかりません。コードを確認するか、新しく作成してください。');
        if (message.type === 'resume') {
          index = room.seats.findIndex((s) => s?.token === message.token);
          if (index < 0 || room.seats[index]?.peer) return fail('この接続では復帰できません。');
          if (this.now() - room.seats[index]!.disconnectedAt >= RECONNECT_MS)
            return fail('再接続の猶予時間を過ぎました。');
        } else {
          index = room.seats.findIndex((s) => !s);
          if (index < 0 || room.match) return fail('このルームは満員、または対戦中です。');
        }
      }
      const seat = room.seats[index] ?? {
        token: randomToken(),
        peer: null,
        disconnectedAt: 0,
        ready: false,
        seq: -1,
        inputAt: 0,
        held: 0,
        queue: [],
      };
      seat.peer = peer;
      seat.seq = -1;
      room.seats[index] = seat;
      room.touchedAt = this.now();
      this.peers.set(peer, { room, seat, index });
      peer.send({ type: 'joined', code: room.code, token: seat.token, seat: index });
      this.broadcast(room);
      return;
    }
    if (!membership) return fail('先にルームに参加してください。');
    const { room, seat, index } = membership;
    if (message.type === 'leave') {
      this.close(
        room,
        'プレイヤーが退室しました。',
        room.match?.phase === 'finished' ? room.match.winner : room.match ? 1 - index : null,
      );
      return;
    }
    if (message.matchId !== room.matchId || message.round !== (room.match?.round ?? 0)) return;
    if (message.type === 'ready') {
      if (room.match && !['roundOver', 'finished'].includes(room.match.phase)) return;
      seat.ready = true;
      room.touchedAt = this.now();
      if (room.seats.every((s) => s?.peer && s.ready)) {
        if (room.match?.phase === 'roundOver') nextRound(room.match);
        else {
          room.match = createMatch('versus', this.seed());
          room.matchId = crypto.randomUUID();
        }
        for (const s of room.seats)
          if (s) {
            s.ready = false;
            s.held = 0;
            s.queue = [];
          }
      }
      this.broadcast(room);
    } else if (message.type === 'input') {
      if (room.match?.phase !== 'playing' || message.seq <= seat.seq) return;
      seat.seq = message.seq;
      seat.inputAt = this.now();
      // Bound queued edges; one input frame is consumed per authoritative tick.
      if (seat.queue.length >= 8) {
        seat.queue = [];
        seat.held = 0;
        return;
      }
      seat.queue.push({ held: message.input.held, pressed: message.input.pressed });
    }
  }

  disconnect(peer: Peer): void {
    const membership = this.peers.get(peer);
    if (!membership) return;
    this.peers.delete(peer);
    const { room, seat } = membership;
    seat.peer = null;
    seat.disconnectedAt = this.now();
    seat.ready = false;
    seat.held = 0;
    seat.queue = [];
    this.broadcast(room);
  }

  tick(): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      const expired = room.seats.findIndex(
        (s) => s && !s.peer && now - s.disconnectedAt >= RECONNECT_MS,
      );
      if (expired >= 0) {
        const winner =
          room.match?.phase === 'finished'
            ? room.match.winner
            : room.match && room.seats[1 - expired]?.peer
              ? 1 - expired
              : null;
        this.close(room, '再接続の猶予時間（10秒）を過ぎたため、対戦を終了しました。', winner);
        continue;
      }
      if (
        (!room.match || ['roundOver', 'finished'].includes(room.match.phase)) &&
        now - room.touchedAt > 30 * 60_000
      ) {
        this.close(room, '待機時間が30分を超えたため、ルームを閉じました。', null);
        continue;
      }
      if (!room.match || ['roundOver', 'finished'].includes(room.match.phase)) continue;
      const inputs = room.seats.map((s) => {
        if (!s || !s.peer || now - s.inputAt > 250) {
          if (s) {
            s.held = 0;
            s.queue = [];
          }
          return NO_INPUT;
        }
        const input = s.queue.shift();
        if (input) s.held = input.held;
        return input ?? { held: s.held, pressed: 0 };
      });
      const phase = room.match.phase;
      stepMatch(room.match, inputs);
      room.touchedAt = now;
      if (room.match.tick % 3 === 0 || room.match.events.length || room.match.phase !== phase)
        this.broadcast(room);
    }
  }

  shutdown(): void {
    for (const room of this.rooms.values())
      this.close(room, 'サーバーを停止したため、試合は無効です。', null);
  }
}
