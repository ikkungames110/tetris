import type { DurableObjectState, WebSocket as WorkerSocket } from '@cloudflare/workers-types';
import { Rooms, type Peer } from '../../packages/network/rooms';
import {
  encodeServerMessage,
  handshake,
  parseClientMessage,
  type RoomState,
  type ServerMessage,
  type RatingResult,
} from '../../packages/protocol/online';
import type { Env } from './index';
import { saveMatchResult, type MatchResult, type RatingPlayer } from './ratings';

declare const WebSocketPair: { new (): { 0: WorkerSocket; 1: WorkerSocket } };
type Connection = {
  socket: WorkerSocket;
  peer: Peer;
  player: RatingPlayer;
  lastSeen: number;
  rateStart: number;
  count: number;
};

// A room owns the simulation and authenticates seats at the API gateway.
// No client can submit a winner, rating, or somebody else's account ID.
export class RandomRoom {
  private rooms: Rooms | null = null;
  private connections: Connection[] = [];
  private players: [RatingPlayer, RatingPlayer] = [
    { id: null, rating: null },
    { id: null, rating: null },
  ];
  private snapshot: RoomState | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private settlement: Promise<RatingResult> | null = null;
  private settledId = '';
  private settled: RatingResult | null = null;
  private closed = false;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      const code = url.pathname.split('/').at(-1)!;
      const host = url.searchParams.get('host') === '1';
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return new Response('WebSocket required', { status: 426 });
      if (
        this.closed ||
        this.connections.length >= 2 ||
        (host && this.rooms) ||
        (!host && !this.rooms)
      )
        return new Response('Room unavailable', { status: 409 });
      if (!this.rooms) {
        // After an object restart the old match is void, never recreated as a win.
        if (await this.ctx.storage.get('created'))
          return new Response('Room expired', { status: 410 });
        await this.ctx.storage.put('created', true);
        this.rooms = new Rooms(Date.now, undefined, () => code);
      }
      const player = JSON.parse(request.headers.get('X-Stack-Player')!) as RatingPlayer;
      if (player.id && this.connections.some((c) => c.player.id === player.id))
        return new Response('Already playing in this room', { status: 409 });
      const pair = new WebSocketPair();
      const socket = pair[1];
      socket.accept();
      const connection: Connection = {
        socket,
        player,
        lastSeen: Date.now(),
        rateStart: Date.now(),
        count: 0,
        peer: { send: (message) => this.deliver(connection, message) },
      };
      this.players[this.connections.length] = player;
      this.connections.push(connection);
      socket.addEventListener('message', (event) => {
        if (this.closed) return;
        const now = Date.now();
        if (now - connection.rateStart >= 1000) {
          connection.rateStart = now;
          connection.count = 0;
        }
        const message =
          typeof event.data === 'string' && event.data.length <= 2048
            ? parseClientMessage(event.data)
            : null;
        if (
          ++connection.count > 180 ||
          !message ||
          !['input', 'ready', 'leave', 'ping'].includes(message.type)
        ) {
          this.disconnect(connection);
          return;
        }
        connection.lastSeen = now;
        this.rooms?.handle(connection.peer, message);
      });
      socket.addEventListener('close', () => this.disconnect(connection));
      socket.addEventListener('error', () => this.disconnect(connection));
      this.rooms.handle(
        connection.peer,
        host
          ? { type: 'create', ...handshake, options: { kind: 'random', handicap: null } }
          : { type: 'join', code, ...handshake },
      );
      this.startTimer();
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    });
  }

  private send(connection: Connection, message: ServerMessage): void {
    try {
      connection.socket.send(encodeServerMessage(message));
    } catch {
      /* Close event owns the forfeit. */
    }
  }

  private closeSocket(connection: Connection): void {
    try {
      connection.socket.close(1000, 'Room closed');
    } catch {
      /* The transport may already be gone. */
    }
  }

  private deliver(connection: Connection, message: ServerMessage): void {
    if (message.type === 'room') {
      this.snapshot = message;
      message = { ...message, ratings: this.players.map((p) => p.rating) as RoomState['ratings'] };
    }
    const complete = message.type === 'room' && message.match?.phase === 'finished';
    const closing = message.type === 'closed';
    const winner =
      message.type === 'room' && complete
        ? message.match!.winner
        : message.type === 'closed'
          ? message.winner
          : null;
    if (complete && this.settledId === this.snapshot?.matchId) {
      this.send(connection, message);
      return;
    }
    if (closing) {
      this.closed = true;
      clearInterval(this.timer);
    }
    if ((complete || closing) && winner !== null && this.snapshot?.match) {
      const finalMessage = message;
      const saving = this.finish(winner);
      this.ctx.waitUntil(
        saving
          .then((rating) => {
            if (closing) this.send(connection, rating);
            this.send(connection, finalMessage);
            if (!closing) this.send(connection, rating);
            if (closing) this.closeSocket(connection);
          })
          .catch(() => {
            this.send(connection, finalMessage);
            if (closing) this.closeSocket(connection);
          }),
      );
      return;
    }
    this.send(connection, message);
    if (closing) this.closeSocket(connection);
  }

  private finish(winner: number): Promise<RatingResult> {
    const matchId = this.snapshot!.matchId;
    if (this.settledId === matchId && this.settled) return Promise.resolve(this.settled);
    if (this.settlement) return this.settlement;
    const result: MatchResult = { matchId, winner, players: structuredClone(this.players) };
    this.settlement = (async () => {
      await this.ctx.storage.put('pending', result);
      // The alarm retries even after both browsers have left or the object restarts.
      await this.ctx.storage.setAlarm(Date.now() + 5000);
      return this.persist(result);
    })();
    return this.settlement;
  }

  private async persist(result: MatchResult): Promise<RatingResult> {
    const rating = await saveMatchResult(this.env.DB, result);
    await this.ctx.storage.delete('pending');
    await this.ctx.storage.deleteAlarm();
    this.settledId = result.matchId;
    this.settled = rating;
    this.players.forEach((player, i) => {
      player.rating = rating.ratings[i];
    });
    this.settlement = null;
    return rating;
  }

  async alarm(): Promise<void> {
    const result = await this.ctx.storage.get<MatchResult>('pending');
    if (!result) return;
    try {
      const rating = await this.persist(result);
      for (const connection of this.connections) this.send(connection, rating);
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + 5000);
    }
  }

  private disconnect(connection: Connection): void {
    if (!this.connections.includes(connection) || this.closed) return;
    this.rooms?.disconnect(connection.peer);
    this.closeSocket(connection);
  }

  private startTimer(): void {
    if (this.timer) return;
    let previous = Date.now(),
      accumulator = 0;
    this.timer = setInterval(() => {
      if (this.closed) return;
      const now = Date.now();
      // Check both peers together; a server stall must not arbitrarily award a win.
      if (now - previous > 2000 || this.connections.every((c) => now - c.lastSeen > 6000)) {
        this.rooms?.shutdown();
        return;
      }
      for (const connection of this.connections) {
        if (now - connection.lastSeen > 6000) {
          this.disconnect(connection);
          return;
        }
      }
      accumulator += Math.min(now - previous, 100);
      previous = now;
      if (this.settlement) {
        accumulator = 0;
        return;
      }
      while (accumulator >= 1000 / 60 && !this.closed && !this.settlement) {
        accumulator -= 1000 / 60;
        this.rooms?.tick();
      }
    }, 1000 / 60);
  }
}
