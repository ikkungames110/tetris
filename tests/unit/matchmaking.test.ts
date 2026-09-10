import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Matchmaker } from '../../apps/web/matchmaking';

const transport = vi.hoisted(() => {
  class Peer {
    static instances: Peer[] = [];
    handlers = new Map<string, (value?: unknown) => void>();
    destroyed = false;
    constructor() {
      Peer.instances.push(this);
    }
    on(event: string, callback: (value?: unknown) => void) {
      this.handlers.set(event, callback);
    }
    emit(event: string, value?: unknown) {
      this.handlers.get(event)?.(value);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { Peer };
});
vi.mock('peerjs', () => ({ default: transport.Peer, SerializationType: { None: 'none' } }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { RTCPeerConnection: class {} });
  transport.Peer.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps searching after repeated signaling failures and does not expire an idle waiter', () => {
  const callbacks = {
    host: vi.fn(),
    guest: vi.fn(),
    reset: vi.fn(),
    status: vi.fn(),
    error: vi.fn(),
  };
  const matchmaker = new Matchmaker(callbacks);
  matchmaker.start([]);
  for (let i = 0; i < 8; i++) {
    transport.Peer.instances.at(-1)!.emit('error', { type: 'network' });
    vi.advanceTimersByTime(6000);
    expect(matchmaker.running).toBe(true);
  }
  expect(transport.Peer.instances).toHaveLength(9);
  transport.Peer.instances.at(-1)!.emit('open');
  vi.advanceTimersByTime(60 * 60 * 1000);
  expect(callbacks.host).toHaveBeenCalledOnce();
  expect(callbacks.error).not.toHaveBeenCalled();
  expect(matchmaker.running).toBe(true);
  matchmaker.stop();
});

it('requeues a lost waiting room, and cancel stops pending retries and stale callbacks', () => {
  const callbacks = {
    host: vi.fn(),
    guest: vi.fn(),
    reset: vi.fn(),
    status: vi.fn(),
    error: vi.fn(),
  };
  const matchmaker = new Matchmaker(callbacks);
  matchmaker.start([]);
  const first = transport.Peer.instances[0];
  first.emit('open');
  matchmaker.reconnect();
  vi.advanceTimersByTime(6000);
  expect(callbacks.reset).toHaveBeenCalledOnce();
  expect(transport.Peer.instances).toHaveLength(2);
  expect(first.destroyed).toBe(true);
  matchmaker.reconnect();
  matchmaker.stop();
  first.emit('error', { type: 'network' });
  matchmaker.reconnect();
  vi.advanceTimersByTime(60_000);
  expect(matchmaker.running).toBe(false);
  expect(transport.Peer.instances).toHaveLength(2);
  expect(callbacks.error).not.toHaveBeenCalled();
});
