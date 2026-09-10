import PeerJS, { SerializationType, type DataConnection } from 'peerjs';
import { handshake } from '../../packages/protocol/online';
import { peerOptions } from './peer-config';

// The signaling service atomically assigns this ID to one waiting browser.
// A second browser connects to it. No peer directory or game server is required.
const transport = import.meta.env.VITE_ACCOUNTS_ENABLED === 'false' ? 'p2p' : 'server';
const QUEUE_ID = `stack-tetris-queue-${handshake.version}-${handshake.rules}-${transport}`;
export class Matchmaker {
  running = false;
  private peer: PeerJS | null = null;
  private candidate: DataConnection | null = null;
  private code = '';
  private accepted = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private ice: RTCIceServer[] = [];
  private failures = 0;

  constructor(
    private callbacks: {
      host: () => void;
      guest: (code: string) => void;
      reset: () => void;
      status: (text: string) => void;
      error: (text: string) => void;
    },
  ) {}

  start(ice: RTCIceServer[]): void {
    this.stop();
    if (!window.RTCPeerConnection) {
      this.callbacks.error('このブラウザーはWebRTCに対応していません。');
      return;
    }
    this.running = true;
    this.ice = ice;
    this.failures = 0;
    this.claim();
  }

  offer(code: string): void {
    this.code = code;
    this.sendOffer();
  }

  reconnect(): void {
    this.retryQueue(true);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.retry);
    this.disposeAttempt();
  }

  private disposeAttempt(): void {
    clearTimeout(this.timer);
    const peer = this.peer;
    this.peer = null;
    this.candidate = null;
    this.code = '';
    this.accepted = false;
    peer?.destroy();
  }

  private claim(): void {
    if (!this.running) return;
    this.callbacks.status('対戦相手を待っています…');
    let peer: PeerJS;
    try {
      peer = new PeerJS(QUEUE_ID, peerOptions(this.ice));
    } catch {
      this.fail();
      return;
    }
    this.peer = peer;
    this.timer = setTimeout(() => this.retryQueue(true), 12_000);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      clearTimeout(this.timer);
      this.failures = 0;
      this.callbacks.host();
    });
    peer.on('connection', (connection) => {
      if (this.peer !== peer) {
        connection.close();
        return;
      }
      if (this.candidate) {
        const timeout = setTimeout(() => connection.close(), 4000);
        connection.on('open', () => {
          if (this.peer !== peer) {
            connection.close();
            return;
          }
          void connection.send(JSON.stringify({ type: 'busy', ...handshake }));
          setTimeout(() => connection.close(), 100);
        });
        connection.on('close', () => clearTimeout(timeout));
        connection.on('error', () => connection.close());
        return;
      }
      // Only reserve a seat after a bounded, versioned hello arrives.
      const timeout = setTimeout(() => connection.close(), 4000);
      connection.on('data', (raw) => {
        if (this.peer !== peer) return;
        const message = this.parse(raw);
        if (!message) {
          connection.close();
          return;
        }
        if (message.type === 'hello') {
          if (this.candidate === connection) return;
          if (this.candidate && this.candidate !== connection) {
            void connection.send(JSON.stringify({ type: 'busy', ...handshake }));
            setTimeout(() => connection.close(), 100);
            return;
          }
          clearTimeout(timeout);
          this.candidate = connection;
          this.timer = setTimeout(() => this.retryQueue(true), 18_000);
          this.callbacks.status('対戦相手に接続しています…');
          this.sendOffer();
        } else if (
          message.type === 'accept' &&
          connection === this.candidate &&
          message.code === this.code
        ) {
          this.accepted = true;
        }
      });
      connection.on('close', () => {
        clearTimeout(timeout);
        if (this.peer === peer && this.candidate === connection && !this.accepted)
          this.retryQueue(false);
      });
      connection.on('error', () => connection.close());
    });
    peer.on('error', (error) => {
      if (this.peer !== peer) return;
      if (error.type === 'unavailable-id') {
        this.disposeAttempt();
        this.findWaiting();
      } else this.retryQueue(true);
    });
    peer.on('disconnected', () => {
      if (this.peer === peer) this.retryQueue(true);
    });
  }

  private findWaiting(): void {
    if (!this.running) return;
    const peer = new PeerJS(peerOptions(this.ice));
    this.peer = peer;
    this.timer = setTimeout(() => this.retryQueue(true), 10_000);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      const connection = peer.connect(QUEUE_ID, {
        reliable: true,
        serialization: SerializationType.None,
      });
      this.candidate = connection;
      connection.on('open', () => {
        if (this.peer === peer)
          void connection.send(JSON.stringify({ type: 'hello', ...handshake }));
      });
      connection.on('data', (raw) => {
        if (this.peer !== peer || this.accepted) return;
        const message = this.parse(raw);
        if (!message) {
          this.retryQueue(true);
          return;
        }
        if (message.type === 'busy') {
          this.retryQueue(false);
          return;
        }
        if (message.type !== 'offer' || !message.code) return;
        this.accepted = true;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.retryQueue(true), 18_000);
        void connection.send(JSON.stringify({ type: 'accept', code: message.code, ...handshake }));
        this.callbacks.status('対戦相手に接続しています…');
        this.callbacks.guest(message.code);
      });
      connection.on('close', () => {
        if (this.peer === peer && !this.accepted) this.retryQueue(false);
      });
      connection.on('error', () => {
        if (this.peer === peer && !this.accepted) this.retryQueue(true);
      });
    });
    peer.on('error', (error) => {
      if (this.peer === peer) this.retryQueue(error.type !== 'peer-unavailable');
    });
    peer.on('disconnected', () => {
      if (this.peer === peer && !this.accepted) this.retryQueue(true);
    });
  }

  private sendOffer(): void {
    if (this.candidate?.open && this.code && !this.accepted)
      void this.candidate.send(JSON.stringify({ type: 'offer', code: this.code, ...handshake }));
  }

  private parse(raw: unknown): { type: string; code?: string } | null {
    if (typeof raw !== 'string' || raw.length > 256) return null;
    try {
      const m = JSON.parse(raw);
      if (
        !m ||
        m.version !== handshake.version ||
        m.rules !== handshake.rules ||
        !['hello', 'offer', 'accept', 'busy'].includes(m.type) ||
        (['offer', 'accept'].includes(m.type) &&
          (typeof m.code !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(m.code)))
      )
        return null;
      return m;
    } catch {
      return null;
    }
  }

  private retryQueue(failed: boolean): void {
    if (!this.running) return;
    if (failed) this.failures++;
    this.disposeAttempt();
    this.callbacks.reset();
    this.callbacks.status('対戦相手を探しています…');
    clearTimeout(this.retry);
    // Waiting has no expiry; back off during outages until the user cancels.
    this.retry = setTimeout(
      () => this.claim(),
      Math.min(5000, 300 + this.failures * 500) + Math.random() * 700,
    );
  }
  private fail(): void {
    this.stop();
    this.callbacks.error(
      'マッチングに接続できませんでした。回線やTURN設定を確認して再試行してください。',
    );
  }
}
