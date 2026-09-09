import { createMatch, nextRound, stepMatch } from '../core/engine';
import {
  NO_INPUT,
  RULES,
  type Input,
  type Match,
  type Player,
  type ClearEffect,
} from '../core/types';
import {
  AUTO_NEXT_MS,
  RANDOM_WINS_REQUIRED,
  MAX_WINS_REQUIRED,
  publicMatch,
  RECONNECT_MS,
  type ClientMessage,
  type RoomOptions,
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
  local?: boolean;
}
interface Seat {
  name: string;
  token: string;
  peer: Peer | null;
  disconnectedAt: number;
  ready: boolean;
  seq: number;
  ack: number;
  inputAt: number;
  held: number;
  queue: { seq: number; input: Input }[];
}
interface Room extends RoomOptions {
  winsRequired: number;
  code: string;
  matchId: string;
  seats: [Seat | null, Seat | null];
  match: Match | null;
  restartAt: number | null;
  nextRoundIn: number | null;
}

export class Rooms {
  private clearEffects = new WeakMap<Player, ClearEffect>();
  private rooms = new Map<string, Room>();
  private peers = new Map<Peer, { room: Room; seat: Seat; index: number }>();
  constructor(
    private now = Date.now,
    private seed = () => randomInt(1, 0xffffffff),
    private roomCode?: () => string,
  ) {}

  private broadcast(room: Room, localOnly = false): void {
    const message: ServerMessage = {
      type: 'room',
      kind: room.kind,
      handicap: room.handicap,
      winsRequired: room.winsRequired,
      names: room.seats.map((s) => s?.name ?? 'ゲスト') as [string, string],
      code: room.code,
      matchId: room.matchId,
      connected: room.seats.map((s) => !!s?.peer) as [boolean, boolean],
      ready: room.seats.map((s) => !!s?.ready) as [boolean, boolean],
      match: room.match ? publicMatch(room.match) : null,
      ack: room.seats.map((s) => s?.ack ?? 0) as [number, number],
      nextRoundIn: room.nextRoundIn,
    };
    if (message.match)
      room.match!.players.forEach((player, i) => {
        const effect = this.clearEffects.get(player);
        if (effect) message.match!.players[i].clearEffect = effect;
      });
    for (const seat of room.seats)
      if (seat?.peer && (!localOnly || seat.peer.local)) seat.peer.send(message);
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
          code =
            this.roomCode?.() ??
            Array.from({ length: 6 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
        } while (this.rooms.has(code));
        room = {
          code,
          kind: message.options?.kind ?? 'private',
          winsRequired:
            message.options?.kind === 'random'
              ? RANDOM_WINS_REQUIRED
              : Math.min(
                  MAX_WINS_REQUIRED,
                  Math.max(1, Math.trunc(message.options?.winsRequired ?? 3) || 3),
                ),
          handicap:
            message.options?.kind === 'random'
              ? null
              : structuredClone(message.options?.handicap ?? null),
          matchId: crypto.randomUUID(),
          seats: [null, null],
          match: null,
          restartAt: null,
          nextRoundIn: null,
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
        name: message.type !== 'resume' ? message.name?.trim().slice(0, 40) || 'ゲスト' : 'ゲスト',
        token: randomToken(),
        peer: null,
        disconnectedAt: 0,
        ready: false,
        seq: -1,
        ack: 0,
        inputAt: 0,
        held: 0,
        queue: [],
      };
      seat.peer = peer;
      seat.seq = -1;
      seat.ack = 0;
      room.seats[index] = seat;
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
      if (room.match && (room.match.phase !== 'finished' || room.kind === 'random')) return;
      seat.ready = true;
      if (room.seats.every((s) => s?.peer && s.ready)) this.beginRound(room);
      this.broadcast(room);
    } else if (message.type === 'input') {
      if (room.match?.phase !== 'playing' || message.seq <= seat.seq) return;
      seat.seq = message.seq;
      seat.inputAt = this.now();
      // Bound queued edges; one input frame is consumed per authoritative tick.
      if (seat.queue.length >= 32) {
        seat.queue = [];
        seat.held = 0;
        seat.ack = seat.seq;
        return;
      }
      seat.queue.push({
        seq: message.seq,
        input: { held: message.input.held, pressed: message.input.pressed },
      });
    }
  }

  disconnect(peer: Peer): void {
    const membership = this.peers.get(peer);
    if (!membership) return;
    this.peers.delete(peer);
    const { room, seat, index } = membership;
    if (room.kind === 'random') {
      this.close(
        room,
        '接続が切れたプレイヤーの負けです。',
        room.match?.phase === 'finished' ? room.match.winner : room.match ? 1 - index : null,
      );
      return;
    }
    seat.peer = null;
    seat.disconnectedAt = this.now();
    seat.ready = false;
    seat.held = 0;
    seat.queue = [];
    room.restartAt = null;
    room.nextRoundIn = null;
    this.broadcast(room);
  }

  private beginRound(room: Room): void {
    const rules = { ...RULES, winsRequired: room.winsRequired };
    if (room.match?.phase === 'roundOver') nextRound(room.match, rules);
    else {
      room.match = createMatch('versus', this.seed(), rules);
      room.matchId = crypto.randomUUID();
    }
    room.restartAt = null;
    room.nextRoundIn = null;
    for (const seat of room.seats)
      if (seat) {
        seat.ready = false;
        seat.seq = -1;
        seat.ack = 0;
        seat.held = 0;
        seat.queue = [];
      }
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
      if (!room.match) continue;
      if (room.match.phase === 'finished') continue;
      if (room.match.phase === 'roundOver') {
        if (!room.seats.every((s) => s?.peer)) continue;
        room.restartAt ??= now + AUTO_NEXT_MS;
        if (now >= room.restartAt) {
          this.beginRound(room);
          this.broadcast(room);
          continue;
        }
        const remaining = Math.ceil((room.restartAt - now) / 1000);
        if (room.nextRoundIn !== remaining) {
          room.nextRoundIn = remaining;
          this.broadcast(room);
        }
        continue;
      }
      const inputs = room.seats.map((s) => {
        if (!s || !s.peer || now - s.inputAt > 250) {
          if (s) {
            s.held = 0;
            s.queue = [];
            s.ack = s.seq < 0 ? 0 : s.seq;
          }
          return NO_INPUT;
        }
        // Catch up redundant held-state frames after jitter, preserving every
        // edge and direction change rather than adding an avoidable queue delay.
        while (
          s.queue.length > 2 &&
          !s.queue[0].input.pressed &&
          !s.queue[1].input.pressed &&
          s.queue[0].input.held === s.queue[1].input.held
        ) {
          s.ack = s.queue.shift()!.seq;
        }
        const frame = s.queue.shift();
        if (frame) {
          s.held = frame.input.held;
          s.ack = frame.seq;
        }
        return frame?.input ?? { held: s.held, pressed: 0 };
      });
      const phase = room.match.phase;
      stepMatch(
        room.match,
        inputs,
        { ...RULES, winsRequired: room.winsRequired },
        (player, effect) => this.clearEffects.set(player, effect),
        room.handicap,
      );
      if (
        room.match.phase !== phase &&
        ['roundOver'].includes(room.match.phase) &&
        room.seats.every((s) => s?.peer)
      ) {
        room.restartAt = now + AUTO_NEXT_MS;
        room.nextRoundIn = 3;
      }
      // The host gets every tick; the remote player gets 30Hz corrections.
      this.broadcast(
        room,
        room.match.tick % 2 !== 0 &&
          !room.match.events.length &&
          !room.match.rotationSounds?.length &&
          room.match.phase === phase,
      );
    }
  }

  shutdown(): void {
    for (const room of this.rooms.values())
      this.close(room, 'サーバーを停止したため、試合は無効です。', null);
  }
}
