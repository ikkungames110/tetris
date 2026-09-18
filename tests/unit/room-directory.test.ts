import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomPublisher } from '../../apps/web/room-directory';
import type { RoomState } from '../../packages/protocol/online';

const room: RoomState = {
  type: 'room',
  code: 'ABC234',
  kind: 'private',
  handicap: null,
  winsRequired: 3,
  names: ['ホスト', 'ゲスト'],
  connected: [true, false],
  ready: [false, false],
  ack: [0, 0],
  nextRoundIn: null,
  match: null,
  matchId: 'test',
};
const fetchMock = vi.fn();
const bodies = () => fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('registers once, renews only once a minute without the password and stops on occupancy', async () => {
  const publisher = new RoomPublisher(vi.fn());
  for (let i = 0; i < 100; i++) publisher.update(room, '0123');
  await vi.advanceTimersByTimeAsync(59_999);
  expect(bodies()).toHaveLength(1);
  expect(bodies()[0].password).toBe('0123');
  await vi.advanceTimersByTimeAsync(1);
  expect(bodies()[1]).toEqual({ code: room.code, renew: true });
  publisher.update({ ...room, connected: [true, true] }, '0123');
  await vi.advanceTimersByTimeAsync(0);
  expect(bodies()[2]).toEqual({ code: room.code, remove: true });
  // A disconnected guest still owns its seat during the reconnect grace period.
  publisher.update(room, '0123');
  await vi.advanceTimersByTimeAsync(120_000);
  expect(bodies()).toHaveLength(3);
});

it('recovers an expired listing but never republishes after leaving', async () => {
  const publisher = new RoomPublisher(vi.fn());
  publisher.update(room);
  await vi.advanceTimersByTimeAsync(0);
  fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(bodies()).toHaveLength(3);
  expect(bodies()[2].winsRequired).toBe(3);
  let resolve!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  publisher.stop();
  resolve({ ok: false, status: 404 });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(bodies()).toHaveLength(5);
  expect(bodies().at(-1)).toEqual({ code: room.code, remove: true });
});

it('never registers random matches', async () => {
  const publisher = new RoomPublisher(vi.fn());
  publisher.update({ ...room, kind: 'random' });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetchMock).not.toHaveBeenCalled();
});
