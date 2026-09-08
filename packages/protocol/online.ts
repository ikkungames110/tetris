import {
  PIECES,
  RULES,
  type Input,
  type Handicap,
  type Match,
  type Player,
  type ClearEffect,
} from '../core/types';
import { cells } from '../core/pieces';
import { validTemplateClear, validTemplateProgress } from '../core/templates';

export const PROTOCOL_VERSION = 3;
export const RECONNECT_MS = 10_000;
export const AUTO_NEXT_MS = 3000;
export type PublicPlayer = Omit<Player, 'bag' | 'garbageRng'> & { clearEffect?: ClearEffect };
export type PublicMatch = Omit<Match, 'seed' | 'roundSeed' | 'players'> & {
  players: [PublicPlayer, PublicPlayer];
};
export type RoomOptions = { kind: 'private' | 'random'; handicap: Handicap | null };
export type ClientMessage =
  | { type: 'create'; version: number; rules: string; options?: RoomOptions }
  | { type: 'join'; version: number; rules: string; code: string }
  | { type: 'resume'; version: number; rules: string; code: string; token: string }
  | { type: 'ready'; matchId: string; round: number }
  | { type: 'input'; matchId: string; round: number; seq: number; input: Input }
  | { type: 'leave' }
  | { type: 'ping'; time: number };
export type RoomState = RoomOptions & {
  type: 'room';
  code: string;
  matchId: string;
  connected: [boolean, boolean];
  ready: [boolean, boolean];
  ack: [number, number];
  nextRoundIn: number | null;
  match: PublicMatch | null;
};
export type ServerMessage =
  | { type: 'joined'; code: string; token: string; seat: number }
  | RoomState
  | { type: 'closed'; reason: string; winner: number | null }
  | { type: 'error'; message: string }
  | { type: 'pong'; time: number };

export const handshake = { version: PROTOCOL_VERSION, rules: RULES.version };
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
const code = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(value);

function validRoomOptions(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const options = value as RoomOptions;
  const h = options.handicap;
  return (
    ['private', 'random'].includes(options.kind) &&
    (h === null ||
      (options.kind === 'private' &&
        !!h &&
        (h.seat === 0 || h.seat === 1) &&
        integer(h.lines, 3) &&
        h.lines >= 1))
  );
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const m = JSON.parse(raw);
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    switch (m.type) {
      case 'create':
      case 'join':
      case 'resume':
        if (m.version !== PROTOCOL_VERSION || m.rules !== RULES.version) return null;
        if (m.type === 'create' && m.options !== undefined && !validRoomOptions(m.options))
          return null;
        if (m.type !== 'create' && !code(m.code)) return null;
        if (m.type === 'resume' && (typeof m.token !== 'string' || !/^[a-f0-9]{48}$/.test(m.token)))
          return null;
        return m;
      case 'ready':
      case 'input':
        if (typeof m.matchId !== 'string' || m.matchId.length > 64 || !integer(m.round))
          return null;
        if (
          m.type === 'input' &&
          (!integer(m.seq) ||
            !m.input ||
            !integer(m.input.held, 127) ||
            !integer(m.input.pressed, 127))
        )
          return null;
        return m;
      case 'leave':
        return { type: 'leave' };
      case 'ping':
        return integer(m.time) ? { type: 'ping', time: m.time } : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function encodeServerMessage(message: ServerMessage): string {
  if (message.type !== 'room' || !message.match) return JSON.stringify(message);
  return JSON.stringify({
    ...message,
    match: {
      ...message.match,
      players: message.match.players.map((player) => ({
        ...player,
        board: player.board.map((row) => row.map((cell) => cell ?? '.').join('')).join(''),
      })),
    },
  });
}

// P2P snapshots originate from another browser, so validate before rendering.
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const m = JSON.parse(raw);
    if (!m || typeof m !== 'object') return null;
    const pair = (value: unknown, check: (v: unknown) => boolean) =>
      Array.isArray(value) && value.length === 2 && value.every(check);
    const bool = (v: unknown) => typeof v === 'boolean';
    const winner = (v: unknown) => v === null || v === 0 || v === 1;
    const str = (v: unknown) => typeof v === 'string' && v.length <= 1000;
    if (m.type === 'joined')
      return code(m.code) &&
        typeof m.token === 'string' &&
        /^[a-f0-9]{48}$/.test(m.token) &&
        (m.seat === 0 || m.seat === 1)
        ? m
        : null;
    if (m.type === 'error') return str(m.message) ? m : null;
    if (m.type === 'closed') return str(m.reason) && winner(m.winner) ? m : null;
    if (m.type === 'pong') return integer(m.time) ? m : null;
    if (
      m.type !== 'room' ||
      !validRoomOptions(m) ||
      !code(m.code) ||
      !str(m.matchId) ||
      !pair(m.connected, bool) ||
      !pair(m.ready, bool) ||
      !pair(m.ack, (v) => integer(v)) ||
      !(m.nextRoundIn === null || integer(m.nextRoundIn, 3))
    )
      return null;
    if (m.match === null) return m;
    const match = m.match;
    if (
      !match ||
      match.mode !== 'versus' ||
      !['countdown', 'playing', 'roundOver', 'finished'].includes(match.phase) ||
      !winner(match.winner) ||
      !pair(match.wins, (v) => integer(v, 2))
    )
      return null;
    if (
      !['tick', 'roundTicks', 'round', 'countdown', 'eventId'].every((key) => integer(match[key]))
    )
      return null;
    if (
      !Array.isArray(match.events) ||
      match.events.length > 32 ||
      !match.events.every(
        (e: Record<string, unknown>) =>
          e &&
          integer(e.id) &&
          integer(e.tick) &&
          integer(e.amount) &&
          (e.spin === undefined || ['none', 'mini', 'full'].includes(String(e.spin))) &&
          (e.perfect === undefined || typeof e.perfect === 'boolean') &&
          (e.ren === undefined || integer(e.ren, 216000)) &&
          (e.template === undefined ||
            (e.type === 'clear' && validTemplateClear(e.template, e.spin, e.amount))) &&
          ['lock', 'clear', 'garbage', 'roundEnd'].includes(String(e.type)),
      )
    )
      return null;
    if (
      match.rotationSounds !== undefined &&
      (!Array.isArray(match.rotationSounds) ||
        match.rotationSounds.length > 2 ||
        !match.rotationSounds.every(
          (rotation: Record<string, unknown>) =>
            rotation &&
            integer(rotation.tick, match.tick) &&
            integer(rotation.player, 1) &&
            ['none', 'mini', 'full'].includes(String(rotation.spin)),
        ))
    )
      return null;
    const piece = (p: unknown) => PIECES.includes(p as (typeof PIECES)[number]);
    if (Array.isArray(match.players))
      for (const p of match.players) {
        if (p && typeof p.board === 'string') {
          if (!/^[.IJLOSTZG]{400}$/.test(p.board)) return null;
          const cells = [...p.board].map((c) => (c === '.' ? null : c));
          p.board = Array.from({ length: 40 }, (_, i) => cells.slice(i * 10, (i + 1) * 10));
        }
      }
    if (
      !pair(match.players, (value) => {
        if (!value || typeof value !== 'object') return false;
        const p = value as PublicPlayer;
        return (
          validTemplateProgress(p.templateProgress) &&
          (p.clearEffect === undefined ||
            (!!p.clearEffect &&
              integer(p.clearEffect.piece) &&
              integer(p.clearEffect.tick) &&
              Array.isArray(p.clearEffect.rows) &&
              p.clearEffect.rows.length <= 4 &&
              p.clearEffect.rows.every(
                (row) =>
                  row &&
                  integer(row.y, 19) &&
                  typeof row.cells === 'string' &&
                  /^[IJLOSTZG]{10}$/.test(row.cells),
              ))) &&
          Array.isArray(p.board) &&
          p.board.length === 40 &&
          p.board.every(
            (row) =>
              Array.isArray(row) &&
              row.length === 10 &&
              row.every((c) => c === null || c === 'G' || piece(c)),
          ) &&
          (p.active === null ||
            (!!p.active &&
              piece(p.active.type) &&
              Number.isInteger(p.active.x) &&
              Math.abs(p.active.x) < 50 &&
              Number.isInteger(p.active.y) &&
              Math.abs(p.active.y) < 50 &&
              integer(p.active.rotation, 3) &&
              cells(p.active).every(([x, y]) => x >= 0 && x < 10 && y >= -20 && y < 20))) &&
          Array.isArray(p.next) &&
          p.next.length === 5 &&
          p.next.every(piece) &&
          (p.hold === null || piece(p.hold)) &&
          bool(p.holdUsed) &&
          bool(p.b2b) &&
          bool(p.dead) &&
          bool(p.touchedGround) &&
          (p.rotationKick === null || integer(p.rotationKick, 4)) &&
          [p.fallTicks, p.lockTicks, p.resets, p.wait, p.directionTicks].every((v) => integer(v)) &&
          [-1, 0, 1].includes(p.direction) &&
          Number.isInteger(p.ren) &&
          p.ren >= -1 &&
          str(p.deathReason) &&
          !!p.stats &&
          ['pieces', 'lines', 'sent', 'cancelled', 'received'].every((key) =>
            integer(p.stats[key as keyof Player['stats']]),
          ) &&
          Array.isArray(p.incoming) &&
          p.incoming.length < 1024 &&
          p.incoming.every(
            (g) => g && integer(g.lines) && integer(g.id) && integer(g.eligibleTick),
          ) &&
          Number.isInteger(p.lastClearTick) &&
          (p.lastClear === null ||
            (!!p.lastClear &&
              integer(p.lastClear.lines, 4) &&
              ['none', 'mini', 'full'].includes(p.lastClear.spin) &&
              (p.lastClear.template === undefined ||
                validTemplateClear(p.lastClear.template, p.lastClear.spin, p.lastClear.lines)) &&
              bool(p.lastClear.perfect)))
        );
      })
    )
      return null;
    return m;
  } catch {
    return null;
  }
}

export function publicMatch(match: Match): PublicMatch {
  const { seed: _seed, roundSeed: _roundSeed, players, ...visible } = match;
  return {
    ...visible,
    players: players.map(({ bag: _bag, garbageRng: _rng, ...player }) => player) as [
      PublicPlayer,
      PublicPlayer,
    ],
  };
}

// Display adapter only. These placeholders must never be used to simulate online play.
export function displayMatch(match: PublicMatch): Match {
  const player = (p: PublicPlayer): Player => ({
    ...p,
    bag: { rng: 0, remaining: [] },
    garbageRng: 0,
  });
  return {
    ...match,
    seed: 0,
    roundSeed: 0,
    players: [player(match.players[0]), player(match.players[1])],
  };
}
