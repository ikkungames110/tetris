import { handshake, type RoomState } from '../../packages/protocol/online';

export type ListedRoom = {
  id: string;
  name: string;
  winsRequired: number;
  locked: boolean;
  handicap: RoomState['handicap'];
};

// Only open seats are advertised. Waiting hosts renew once a minute; readers
// request a snapshot on entry or explicit refresh, never poll in the background.
export class RoomPublisher {
  private code = '';
  private occupiedCode = '';
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(private error: (message: string) => void) {}

  update(room: RoomState, password?: string): void {
    if (import.meta.env.VITE_ACCOUNTS_ENABLED === 'false') return;
    if (room.match || room.connected[1]) this.occupiedCode = room.code;
    if (room.kind !== 'private' || this.occupiedCode === room.code) {
      this.stop();
      return;
    }
    if (this.code === room.code) return;
    this.stop();
    this.code = room.code;
    const body = {
      code: room.code,
      winsRequired: room.winsRequired,
      handicap: room.handicap,
      password,
      ...handshake,
    };
    this.send(body);
    this.timer = setInterval(() => this.send({ code: room.code, renew: true }, body), 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
    if (this.code) this.send({ code: this.code, remove: true });
    this.code = '';
  }

  private send(
    body: { code: string; [key: string]: unknown },
    registration?: { code: string; [key: string]: unknown },
  ): void {
    this.pending = this.pending.then(async () => {
      try {
        const response = await fetch('./api/v1/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 404 && registration && this.code === registration.code) {
          this.send(registration);
          return;
        }
        if (!response.ok) throw new Error();
      } catch {
        if (this.code === body.code)
          this.error(
            'ルーム一覧に登録できませんでした。通信状態を確認してください。1分後に再試行します。',
          );
      }
    });
  }
}
