import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, expect, it } from 'vitest';
import { attachOnline } from '../../apps/server/socket';
import { handshake } from '../../packages/protocol/online';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function server() {
  const http = createServer();
  const stop = attachOnline(http);
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const host = `127.0.0.1:${(http.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    stop();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return { url: `ws://${host}/online`, origin: `http://${host}` };
}
async function connect() {
  const { url, origin } = await server();
  const socket = new WebSocket(url, { origin });
  await once(socket, 'open');
  return socket;
}

it('accepts same-origin browsers and serves the room protocol over a real socket', async () => {
  const socket = await connect();
  const received = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'create', ...handshake }));
  const [raw] = await received;
  expect(JSON.parse(raw.toString())).toMatchObject({ type: 'joined', seat: 0 });
  const closed = once(socket, 'close');
  socket.close();
  await closed;
});

it('rejects cross-origin upgrades', async () => {
  const { url } = await server();
  const socket = new WebSocket(url, { origin: 'https://untrusted.example' });
  const [error] = await once(socket, 'error');
  expect(error.message).toContain('403');
});

it('closes oversized and invalid messages without crashing the server', async () => {
  for (const body of ['x'.repeat(2049), '{']) {
    const socket = await connect();
    const closed = once(socket, 'close');
    socket.send(body);
    const [code] = await closed;
    expect(code).toBe(body.length > 2048 ? 1009 : 1008);
  }
});
