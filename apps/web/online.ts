import PeerJS, { SerializationType, type DataConnection } from 'peerjs';
import { peerOptions } from './peer-config';
import { PlayerPrediction } from '../../packages/network/prediction';
import { Rooms, type Peer } from '../../packages/network/rooms';
import {
  encodeServerMessage,
  handshake,
  PROTOCOL_VERSION,
  type RoomOptions,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type RoomState,
  type ServerMessage,
} from '../../packages/protocol/online';
import type { Input } from '../../packages/core/types';

const PREFIX = `stack-p2p-v${PROTOCOL_VERSION}-`;
const STORAGE = `stack-p2p-guest-v${PROTOCOL_VERSION}`;
type Session = { code: string; token: string; seat: number };

export class OnlineClient {
  room: RoomState | null = null;
  session: Session | null = null;
  connected = false;
  busy = false;
  latency = 0;
  private peer: PeerJS | null = null;
  private connection: DataConnection | null = null;
  private rooms: Rooms | null = null;
  private local: Peer | null = null;
  private connections = new Set<DataConnection>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private brokerRetry: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
  private deadline = 0;
  private lastMessage = 0;
  private lastInput = 0;
  private inputAccumulator = 0;
  private bufferedInput: Input = { held: 0, pressed: 0 };
  readonly prediction = new PlayerPrediction();
  private seq = 0;
  private iceServers: RTCIceServer[] = [];

  constructor(
    private onMessage: (message: ServerMessage) => void,
    private onStatus: (text: string) => void,
  ) {}

  get isHost(): boolean {
    return !!this.rooms;
  }

  restore(): boolean {
    try {
      const session = JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null') as Session | null;
      if (
        !session ||
        session.seat !== 1 ||
        !/^[A-HJ-NP-Z2-9]{6}$/.test(session.code) ||
        !/^[a-f0-9]{48}$/.test(session.token)
      )
        return false;
      this.begin(session.code, [], session);
      return true;
    } catch {
      return false;
    }
  }

  open(code?: string, iceServers: RTCIceServer[] = [], options?: RoomOptions): void {
    this.leave();
    this.begin(code, iceServers, undefined, options);
  }

  private begin(
    code?: string,
    iceServers: RTCIceServer[] = [],
    resume?: Session,
    options?: RoomOptions,
  ): void {
    this.busy = true;
    this.iceServers = iceServers;
    this.session = resume ?? null;
    this.deadline = resume ? Date.now() + 10_000 : 0;
    if (resume) this.armReconnectTimeout();
    this.onStatus(resume ? 'ホストへ再接続しています…' : 'P2Pの接続を準備しています…');
    if (!window.RTCPeerConnection) {
      this.fail('このブラウザーはWebRTCに対応していません。');
      return;
    }
    const pending: ServerMessage[] = [];
    let hostOpen = false;
    if (!code) {
      this.rooms = new Rooms();
      const rooms = this.rooms;
      this.local = {
        local: true,
        send: (message) => {
          const copy = structuredClone(message);
          if (!hostOpen) pending.push(copy);
          else
            queueMicrotask(() => {
              if (this.rooms === rooms) this.receive(copy);
            });
        },
      };
      this.rooms.handle(this.local, { type: 'create', ...handshake, options });
    }
    const created = pending.find((m) => m.type === 'joined');
    const peerConfig = peerOptions(this.iceServers);
    let peer: PeerJS;
    try {
      peer = new PeerJS(PREFIX + (created?.code ?? crypto.randomUUID()), peerConfig);
    } catch {
      this.fail('P2P接続を初期化できませんでした。HTTPSまたはlocalhostで開いてください。');
      return;
    }
    this.peer = peer;
    this.timeout = setTimeout(
      () =>
        this.fail(
          '接続できませんでした。招待コード・ホストの画面・回線を確認してください。直接接続できない回線ではTURN設定が必要です。',
        ),
      15_000,
    );
    peer.on('open', () => {
      if (this.peer !== peer) return;
      if (this.rooms && !hostOpen) {
        hostOpen = true;
        for (const message of pending) this.receive(message);
        let previous = performance.now(),
          accumulator = 0;
        this.timer = setInterval(() => {
          const now = performance.now();
          // Browser suspension must not turn into a burst of old inputs.
          if (now - previous > 2000) {
            this.end({
              type: 'closed',
              reason: 'ホストの画面が長時間停止したため、試合を終了しました。',
              winner: null,
            });
            return;
          }
          accumulator += Math.min(now - previous, 100);
          previous = now;
          while (accumulator >= 1000 / 60 && this.rooms) {
            accumulator -= 1000 / 60;
            this.rooms.tick();
          }
        }, 1000 / 60);
      } else if (!this.rooms && !this.connection) this.connectGuest(code!);
    });
    peer.on('connection', (connection) => {
      if (this.peer !== peer || !this.rooms) {
        connection.close();
        return;
      }
      this.accept(connection);
    });
    peer.on('disconnected', () => {
      clearTimeout(this.brokerRetry);
      this.brokerRetry = setTimeout(() => {
        if (this.peer === peer && peer.disconnected && !peer.destroyed) peer.reconnect();
      }, 1000);
    });
    peer.on('error', (error) => {
      if (this.peer !== peer) return;
      // Signaling outages don't interrupt an already established data channel.
      if (this.connection?.open || (this.rooms && this.connections.size > 0)) return;
      if (this.deadline) {
        this.retryGuest(code!);
        return;
      }
      this.fail(
        error.type === 'peer-unavailable'
          ? 'ルームが見つかりません。コードを確認し、ホストが画面を開いたままか確認してください。'
          : error.type === 'unavailable-id'
            ? '招待コードが使用中です。もう一度ルームを作成してください。'
            : '接続仲介サービスに接続できませんでした。ネットワークを確認して再度お試しください。',
      );
    });
  }

  private accept(connection: DataConnection): void {
    if (this.connections.size >= 4) {
      connection.close();
      return;
    }
    this.connections.add(connection);
    const rooms = this.rooms!;
    const remote: Peer = {
      send: (message) => {
        this.sendData(connection, message);
        if (message.type === 'error') setTimeout(() => connection.close(), 100);
      },
    };
    let rateStart = Date.now(),
      count = 0,
      joined = false,
      lastSeen = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastSeen > 5000) connection.close();
    }, 1000);
    connection.on('data', (raw) => {
      if (Date.now() - rateStart >= 1000) {
        rateStart = Date.now();
        count = 0;
      }
      if (++count > 180 || typeof raw !== 'string' || raw.length > 2048) {
        connection.close();
        return;
      }
      const message = parseClientMessage(raw);
      if (
        !message ||
        message.type === 'create' ||
        ((message.type === 'join' || message.type === 'resume') &&
          message.code !== this.session?.code)
      ) {
        remote.send({
          type: 'error',
          message:
            '通信形式またはゲームのバージョンが一致しません。両者のページを更新してください。',
        });
        return;
      }
      if (!joined && !['join', 'resume'].includes(message.type)) {
        connection.close();
        return;
      }
      if (message.type === 'join' || message.type === 'resume') joined = true;
      lastSeen = Date.now();
      rooms.handle(remote, message);
    });
    connection.on('close', () => {
      clearInterval(watchdog);
      this.connections.delete(connection);
      rooms.disconnect(remote);
    });
    connection.on('error', () => connection.close());
  }

  private connectGuest(code: string): void {
    const peer = this.peer;
    if (!peer || peer.destroyed) return;
    const connection = peer.connect(PREFIX + code, {
      reliable: true,
      serialization: SerializationType.None,
    });
    this.connection = connection;
    this.lastMessage = Date.now();
    connection.on('open', () => {
      if (this.connection !== connection) return;
      this.sendData(
        connection,
        this.session
          ? { type: 'resume', code, token: this.session.token, ...handshake }
          : { type: 'join', code, ...handshake },
      );
    });
    connection.on('data', (raw) => {
      if (this.connection !== connection) return;
      const message =
        typeof raw === 'string' && raw.length <= 128_000 ? parseServerMessage(raw) : null;
      if (!message) {
        this.fail('対戦相手からの通信形式が不正です。接続を終了しました。');
        return;
      }
      this.receive(message);
    });
    connection.on('close', () => {
      if (this.connection !== connection) return;
      this.connection = null;
      this.connected = false;
      if (!this.session) {
        this.fail('接続が切れました。ホストの画面とTURN設定を確認してください。');
        return;
      }
      this.retryGuest(code);
    });
    connection.on('error', () => connection.close());
  }

  private retryGuest(code: string): void {
    if (!this.session || this.rooms) return;
    this.deadline ||= Date.now() + 10_000;
    this.armReconnectTimeout();
    if (Date.now() >= this.deadline) {
      this.end({
        type: 'closed',
        reason: 'ホストとの接続を復旧できませんでした。ルームを作り直してください。',
        winner: null,
      });
      return;
    }
    this.busy = true;
    this.connected = false;
    this.onStatus('ホストへ再接続しています…（ホストの画面で対戦は進行します）');
    clearTimeout(this.retry);
    const previous = this.connection;
    this.connection = null;
    previous?.close();
    this.retry = setTimeout(() => this.connectGuest(code), 500);
  }

  private armReconnectTimeout(): void {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(
      () => {
        if (!this.connected)
          this.end({
            type: 'closed',
            reason: 'ホストとの接続を復旧できませんでした。ルームを作り直してください。',
            winner: null,
          });
      },
      Math.max(0, this.deadline - Date.now()),
    );
  }

  private receive(message: ServerMessage): void {
    this.lastMessage = Date.now();
    if (message.type === 'joined') {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
      clearTimeout(this.timeout);
      clearTimeout(this.retry);
      this.session = { code: message.code, token: message.token, seat: message.seat };
      this.connected = true;
      this.busy = false;
      this.deadline = 0;
      this.resetInput();
      if (message.seat === 1) {
        try {
          sessionStorage.setItem(STORAGE, JSON.stringify(this.session));
        } catch {
          /* Optional persistence. */
        }
        clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
          if (Date.now() - this.lastMessage > 5000) {
            this.retryGuest(message.code);
            return;
          }
          this.send({ type: 'ping', time: Date.now() });
        }, 1000);
      }
    } else if (message.type === 'room') {
      if (
        message.matchId !== this.room?.matchId ||
        message.match?.round !== this.room?.match?.round ||
        message.match?.phase !== this.room?.match?.phase
      )
        this.resetInput();
      this.room = message;
      if (!this.isHost && message.match?.phase === 'playing' && this.session) {
        this.prediction.reconcile(
          message.match.players[this.session.seat],
          message.match.tick,
          message.ack[this.session.seat],
          message.handicap?.seat === this.session.seat ? message.handicap.lines : 0,
        );
      }
    } else if (message.type === 'pong') this.latency = Math.max(0, Date.now() - message.time);
    else if (message.type === 'closed' || message.type === 'error') {
      this.dispose();
    }
    this.onMessage(message);
  }

  private sendData(connection: DataConnection, message: ServerMessage | ClientMessage): void {
    if (!connection.open) return;
    if (connection.dataChannel.bufferedAmount > 512_000) {
      connection.close();
      return;
    }
    try {
      void connection.send(
        message.type === 'room' ? encodeServerMessage(message) : JSON.stringify(message),
      );
    } catch {
      connection.close();
    }
  }

  private send(message: ClientMessage): void {
    if (this.rooms && this.local) this.rooms.handle(this.local, message);
    else if (this.connection) this.sendData(this.connection, message);
  }

  ready(): void {
    if (this.room && this.connected)
      this.send({ type: 'ready', matchId: this.room.matchId, round: this.room.match?.round ?? 0 });
  }

  private resetInput(): void {
    this.seq = 0;
    this.lastInput = performance.now();
    this.inputAccumulator = 0;
    this.bufferedInput = { held: 0, pressed: 0 };
    this.prediction.reset();
  }

  input(input: Input, force = false): void {
    if (!this.connected || this.room?.match?.phase !== 'playing') return;
    const now = performance.now();
    this.inputAccumulator += Math.min(now - this.lastInput, 100);
    this.lastInput = now;
    this.bufferedInput.held = input.held & 127;
    this.bufferedInput.pressed = force ? 0 : this.bufferedInput.pressed | (input.pressed & 127);
    if (force) this.inputAccumulator = 1000 / 60;
    // Use simulation frames, not display refresh rate, so DAS/ARR and edge
    // replay agree on 60Hz, 144Hz displays and mobile devices.
    while (this.inputAccumulator >= 1000 / 60) {
      this.inputAccumulator -= 1000 / 60;
      const frame = { ...this.bufferedInput };
      const seq = ++this.seq;
      if (!this.isHost) this.prediction.input(seq, frame);
      this.send({
        type: 'input',
        matchId: this.room.matchId,
        round: this.room.match.round,
        seq,
        input: frame,
      });
      this.bufferedInput.pressed = 0;
    }
  }

  private fail(message: string): void {
    this.dispose();
    this.onMessage({ type: 'error', message });
  }
  private end(message: Extract<ServerMessage, { type: 'closed' }>): void {
    if (this.rooms) for (const connection of this.connections) this.sendData(connection, message);
    this.dispose();
    this.onMessage(message);
  }

  leave(): void {
    if (this.connected) this.send({ type: 'leave' });
    this.dispose();
  }

  private dispose(): void {
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    clearTimeout(this.timeout);
    clearTimeout(this.retry);
    clearTimeout(this.brokerRetry);
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = undefined;
    const peer = this.peer;
    this.peer = null;
    this.connection = null;
    this.rooms = null;
    this.local = null;
    this.session = null;
    this.room = null;
    this.connected = false;
    this.busy = false;
    this.deadline = 0;
    this.connections.clear();
    this.resetInput();
    // Allow the final ordered message to leave the data channel before closing it.
    setTimeout(() => peer?.destroy(), 100);
    try {
      sessionStorage.removeItem(STORAGE);
    } catch {
      /* Optional persistence. */
    }
  }
}
