import type { IncomingMessage } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { parseClientMessage } from '../../packages/protocol/online';
import { Rooms, type Peer } from './rooms';

export function attachOnline(server: EventEmitter, allowedOrigins: string[] = []) {
  const rooms = new Rooms();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url !== '/online') return;
    let permitted = false;
    try {
      const origin = new URL(request.headers.origin ?? '');
      permitted = allowedOrigins.length
        ? allowedOrigins.includes(origin.origin)
        : ['http:', 'https:'].includes(origin.protocol) && origin.host === request.headers.host;
    } catch {
      /* Missing/invalid browser origin. */
    }
    if (!permitted || wss.clients.size >= 220) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
  };
  server.on('upgrade', upgrade);
  wss.on('connection', (ws) => {
    const peer: Peer = {
      send(message) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 512_000) {
          ws.terminate();
          return;
        }
        ws.send(JSON.stringify(message));
      },
    };
    let rateStart = Date.now();
    let count = 0;
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 3000);
    ws.on('pong', () => {
      alive = true;
    });
    ws.on('message', (raw, binary) => {
      if (Date.now() - rateStart >= 1000) {
        rateStart = Date.now();
        count = 0;
      }
      if (++count > 180) {
        ws.close(1008, 'Rate limit');
        return;
      }
      const message = binary ? null : parseClientMessage(raw.toString());
      if (!message) {
        peer.send({
          type: 'error',
          message: '通信形式またはバージョンが一致しません。ページを再読み込みしてください。',
        });
        ws.close(1008, 'Invalid message');
        return;
      }
      rooms.handle(peer, message);
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      clearInterval(heartbeat);
      rooms.disconnect(peer);
    });
  });
  let previous = performance.now();
  let accumulator = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min(now - previous, 100);
    previous = now;
    while (accumulator >= 1000 / 60) {
      accumulator -= 1000 / 60;
      rooms.tick();
    }
  }, 1000 / 60);
  return () => {
    clearInterval(timer);
    server.off('upgrade', upgrade);
    rooms.shutdown();
    for (const client of wss.clients) client.close(1001, 'Server shutdown');
    wss.close();
  };
}
