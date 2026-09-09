import { cancelGarbage, calculateAttack, detectSpin } from './attack';
import { cells, collides, HEIGHT, HIDDEN, landing, rotate, WIDTH } from './pieces';
import { random32, takePiece, uniform } from './random';
import { recognizeTemplate, shiftTemplates } from './templates';
import {
  Button,
  NO_INPUT,
  RULES,
  type Cell,
  type ClearResult,
  type ClearObserver,
  type Input,
  type Handicap,
  type Match,
  type Mode,
  type Piece,
  type Player,
  type Rules,
  type RotationObserver,
} from './types';

export function emptyBoard(): Cell[][] {
  return Array.from({ length: HEIGHT + HIDDEN }, () => Array<Cell>(WIDTH).fill(null));
}

export function createPlayer(seed: number, garbageSeed: number): Player {
  const player: Player = {
    board: emptyBoard(),
    active: null,
    bag: { rng: seed >>> 0, remaining: [] },
    next: [],
    hold: null,
    holdUsed: false,
    rotationKick: null,
    fallTicks: 0,
    lockTicks: 0,
    resets: 0,
    touchedGround: false,
    wait: 0,
    direction: 0,
    directionTicks: 0,
    ren: -1,
    b2b: false,
    incoming: [],
    garbageRng: garbageSeed >>> 0,
    dead: false,
    deathReason: '',
    stats: { pieces: 0, lines: 0, sent: 0, cancelled: 0, received: 0 },
    lastClear: null,
    lastClearTick: -1000,
  };
  while (player.next.length < 5) player.next.push(takePiece(player.bag));
  spawn(player);
  return player;
}

function die(player: Player, reason: string): void {
  player.dead = true;
  player.deathReason = reason;
}

export type PieceSupply = () => Piece | null;

export function spawn(player: Player, heldPiece?: Piece, supply?: PieceSupply): void {
  const type = heldPiece ?? player.next.shift();
  if (!type) return;
  while (player.next.length < 5) {
    const next = supply ? supply() : takePiece(player.bag);
    if (!next) break;
    player.next.push(next);
  }
  player.active = { type, x: 3, y: -2, rotation: 0 };
  player.rotationKick = null;
  player.fallTicks = 0;
  player.lockTicks = 0;
  player.resets = 0;
  player.touchedGround = false;
  if (collides(player.board, player.active)) {
    die(player, '出現位置がふさがりました');
    return;
  }
  const lower = { ...player.active, y: -1 };
  if (!collides(player.board, lower)) player.active = lower;
}

function grounded(player: Player): boolean {
  return !!player.active && collides(player.board, { ...player.active, y: player.active.y + 1 });
}

function resetLock(player: Player, wasGrounded: boolean, rules: Rules): void {
  if (wasGrounded && player.resets < rules.lockResets) {
    player.lockTicks = 0;
    player.resets++;
  }
}

function move(player: Player, dx: number, dy: number, rules: Rules): boolean {
  if (!player.active) return false;
  const candidate = { ...player.active, x: player.active.x + dx, y: player.active.y + dy };
  if (collides(player.board, candidate)) return false;
  const wasGrounded = grounded(player);
  player.active = candidate;
  player.rotationKick = null;
  if (dx) resetLock(player, wasGrounded, rules);
  return true;
}

function horizontal(player: Player, input: Input, rules: Rules): boolean {
  const left = !!((input.held | input.pressed) & Button.left);
  const right = !!((input.held | input.pressed) & Button.right);
  const leftPressed = !!(input.pressed & Button.left);
  const rightPressed = !!(input.pressed & Button.right);
  let direction: -1 | 0 | 1 = left ? -1 : right ? 1 : 0;
  if (left && right) {
    direction =
      leftPressed && rightPressed ? 0 : leftPressed ? -1 : rightPressed ? 1 : player.direction;
  }
  if (direction !== player.direction) {
    player.direction = direction;
    player.directionTicks = 0;
    return direction !== 0;
  }
  if (!direction) return false;
  player.directionTicks++;
  return (
    player.directionTicks >= rules.das && (player.directionTicks - rules.das) % rules.arr === 0
  );
}

export function lockPiece(
  player: Player,
  tick: number,
  rules: Rules = RULES,
  onClear?: ClearObserver,
): ClearResult {
  const active = player.active!;
  const fixed = cells(active);
  const spin = detectSpin(player);
  for (const [x, y] of fixed) player.board[y + HIDDEN][x] = active.type;
  const cleared: number[] = [];
  player.board.forEach((row, i) => {
    if (row.every((cell) => cell !== null)) cleared.push(i);
  });
  const lines = cleared.length;
  const template = recognizeTemplate(player, cleared, spin);
  if (lines && onClear)
    onClear(player, {
      tick,
      piece: player.stats.pieces + 1,
      rows: cleared
        .filter((y) => y >= HIDDEN)
        .map((y) => ({ y: y - HIDDEN, cells: player.board[y].join('') })),
    });
  const remaining = player.board.filter((_, i) => !cleared.includes(i));
  player.board = [
    ...Array.from({ length: lines }, () => Array<Cell>(WIDTH).fill(null)),
    ...remaining,
  ];
  const perfect = lines > 0 && player.board.every((row) => row.every((cell) => cell === null));
  player.ren = lines ? player.ren + 1 : -1;
  const difficult = lines > 0 && (spin !== 'none' || lines === 4);
  const b2b = difficult && player.b2b;
  const attack = calculateAttack(lines, spin, perfect, player.b2b, player.ren);
  if (lines) player.b2b = difficult;
  const result = {
    lines,
    spin,
    perfect,
    attack,
    b2b,
    ren: player.ren,
    ...(template ? { template } : {}),
  };
  player.stats.pieces++;
  player.stats.lines += lines;
  if (lines || spin !== 'none') {
    player.lastClear = result;
    player.lastClearTick = tick;
  }
  const lockedAbove = fixed.every(
    ([, y]) =>
      !cleared.includes(y + HIDDEN) && y + cleared.filter((row) => row > y + HIDDEN).length < 0,
  );
  if (lockedAbove) die(player, 'ミノが盤面の上で固定されました');
  player.active = null;
  player.holdUsed = false;
  player.wait = lines ? rules.clearDelay : rules.entryDelay;
  return result;
}

export function stepPlayer(
  player: Player,
  input: Input,
  tick: number,
  rules: Rules = RULES,
  supply?: PieceSupply,
  onClear?: ClearObserver,
  onRotate?: RotationObserver,
): ClearResult | null {
  if (player.dead) return null;
  const repeatMove = horizontal(player, input, rules);
  if (player.wait > 0) {
    player.wait--;
    if (player.wait) return null;
  }
  if (!player.active) spawn(player, undefined, supply);
  if (player.dead || !player.active) return null;
  if (input.pressed & Button.hold && !player.holdUsed) {
    const previous = player.hold;
    player.hold = player.active.type;
    spawn(player, previous ?? undefined, supply);
    player.holdUsed = true;
    return null;
  }
  const cw = !!(input.pressed & Button.cw);
  const ccw = !!(input.pressed & Button.ccw);
  if (cw !== ccw) {
    const wasGrounded = grounded(player);
    const rotated = rotate(player.board, player.active, cw ? 1 : -1);
    if (rotated) {
      player.active = rotated.active;
      player.rotationKick = rotated.kick;
      resetLock(player, wasGrounded, rules);
      onRotate?.(detectSpin(player));
    }
  }
  if (repeatMove) move(player, player.direction, 0, rules);
  if (input.pressed & Button.hard) {
    const ghost = landing(player.board, player.active!);
    if (ghost.y !== player.active!.y) player.rotationKick = null;
    player.active = ghost;
    return lockPiece(player, tick, rules, onClear);
  }
  const interval =
    input.held & Button.soft ? Math.min(rules.gravity, rules.softDrop) : rules.gravity;
  player.fallTicks++;
  if (player.fallTicks >= interval) {
    player.fallTicks = 0;
    move(player, 0, 1, rules);
  }
  if (grounded(player)) {
    player.touchedGround = true;
    player.lockTicks++;
    if (player.lockTicks >= rules.lockDelay) return lockPiece(player, tick, rules, onClear);
  }
  return null;
}

export function receiveGarbage(player: Player, tick: number, rules: Rules = RULES): number {
  let count = 0;
  for (const item of player.incoming) {
    if (item.eligibleTick > tick || count >= rules.garbageCap) break;
    const amount = Math.min(item.lines, rules.garbageCap - count);
    item.lines -= amount;
    count += amount;
  }
  player.incoming = player.incoming.filter((item) => item.lines > 0);
  let hole = 0;
  let overflow = false;
  for (let i = 0; i < count; i++) {
    if (i === 0) [player.garbageRng, hole] = uniform(player.garbageRng, 10);
    else {
      let change: number;
      [player.garbageRng, change] = uniform(player.garbageRng, 10);
      if (change < 3) {
        let other: number;
        [player.garbageRng, other] = uniform(player.garbageRng, 9);
        hole = other >= hole ? other + 1 : other;
      }
    }
    if (player.board.shift()!.some((cell) => cell !== null)) overflow = true;
    player.board.push(Array.from({ length: WIDTH }, (_, x) => (x === hole ? null : 'G')));
  }
  player.stats.received += count;
  shiftTemplates(player, count);
  if (overflow) die(player, 'おじゃまで盤面があふれました');
  return count;
}

export function createMatch(mode: Mode, seed: number, rules: Rules = RULES): Match {
  const roundSeed = seed >>> 0 || 1;
  return {
    mode,
    seed: roundSeed,
    roundSeed,
    tick: 0,
    roundTicks: 0,
    round: 1,
    phase: 'countdown',
    countdown: rules.countdown,
    players: [
      createPlayer(roundSeed, random32(roundSeed)),
      createPlayer(roundSeed, random32(random32(roundSeed))),
    ],
    wins: [0, 0],
    winner: null,
    eventId: 0,
    events: [],
  };
}

export function nextRound(match: Match, rules: Rules = RULES): void {
  if (match.phase !== 'roundOver') return;
  match.roundSeed = random32(match.roundSeed);
  match.round++;
  match.players = [
    createPlayer(match.roundSeed, random32(match.roundSeed)),
    createPlayer(match.roundSeed, random32(random32(match.roundSeed))),
  ];
  match.roundTicks = 0;
  match.phase = 'countdown';
  match.countdown = rules.countdown;
  match.winner = null;
  match.events = [];
  delete match.rotationSounds;
}

function event(
  match: Match,
  player: number,
  type: Match['events'][number]['type'],
  amount = 0,
  spin?: Match['events'][number]['spin'],
  perfect = false,
  ren?: number,
  template?: string,
): void {
  match.events.push({
    id: ++match.eventId,
    tick: match.tick,
    player,
    type,
    amount,
    ...(spin && spin !== 'none' ? { spin } : {}),
    ...(perfect ? { perfect: true } : {}),
    ...(type === 'clear' && ren !== undefined ? { ren } : {}),
    ...(template ? { template } : {}),
  });
}

// Mutates only the supplied state. No clock, browser, I/O or external randomness.
export function stepMatch(
  match: Match,
  inputs: readonly Input[] = [NO_INPUT, NO_INPUT],
  rules: Rules = RULES,
  onClear?: ClearObserver,
  handicap: Handicap | null = null,
): void {
  match.events = [];
  delete match.rotationSounds;
  if (match.phase === 'finished' || match.phase === 'roundOver') return;
  match.tick++;
  if (match.phase === 'countdown') {
    if (--match.countdown <= 0) match.phase = 'playing';
    return;
  }
  match.roundTicks++;
  const count = match.mode === 'versus' ? 2 : 1;
  // Collect both locks before resolving attacks. Player iteration order cannot cancel new attacks.
  const results = match.players.map((player, i) =>
    i < count
      ? stepPlayer(player, inputs[i] ?? NO_INPUT, match.tick, rules, undefined, onClear, (spin) => {
          (match.rotationSounds ??= []).push({ tick: match.tick, player: i, spin });
        })
      : null,
  );
  const outgoing = results.map((result, i) =>
    result
      ? Math.max(
          0,
          cancelGarbage(match.players[i], result.attack) -
            (match.mode === 'versus' && handicap?.seat === i ? handicap.lines : 0),
        )
      : 0,
  );
  for (let i = 0; i < count; i++) {
    const result = results[i];
    if (result)
      event(
        match,
        i,
        result.lines ? 'clear' : 'lock',
        result.lines,
        result.spin,
        result.perfect,
        result.ren,
        result.template,
      );
    if (outgoing[i]) {
      match.players[i].stats.sent += outgoing[i];
      if (count === 2)
        match.players[1 - i].incoming.push({
          id: ++match.eventId,
          lines: outgoing[i],
          eligibleTick: match.tick + rules.garbageDelay,
        });
    }
  }
  for (let i = 0; i < count; i++) {
    if (results[i]?.lines === 0) {
      const amount = receiveGarbage(match.players[i], match.tick, rules);
      if (amount) event(match, i, 'garbage', amount);
    }
  }
  if (match.mode === 'sprint' && match.players[0].stats.lines >= 40) {
    match.winner = 0;
    match.phase = 'finished';
    event(match, 0, 'roundEnd');
    return;
  }
  const dead = match.players.map((player) => player.dead);
  const timedOut = match.mode === 'versus' && match.roundTicks >= rules.roundLimit;
  if (!dead.slice(0, count).some(Boolean) && !timedOut) return;
  match.winner = count === 2 && !timedOut && dead[0] !== dead[1] ? (dead[0] ? 1 : 0) : null;
  if (match.winner !== null) match.wins[match.winner]++;
  match.phase =
    count === 1 || match.wins.some((wins) => wins >= rules.winsRequired) ? 'finished' : 'roundOver';
  event(match, match.winner ?? -1, 'roundEnd');
}

export function stateHash(state: Match): string {
  // 音声用の追加メタデータは既存リプレイの検証値に含めない。
  const { rotationSounds: _rotations, ...gameplay } = state;
  const value = JSON.stringify({
    ...gameplay,
    players: state.players.map(({ templateProgress: _progress, ...player }) => ({
      ...player,
      lastClear: player.lastClear
        ? (({ template: _template, ...clear }) => clear)(player.lastClear)
        : null,
    })),
    events: state.events.map(
      ({ spin: _spin, perfect: _perfect, ren: _ren, template: _template, ...event }) => event,
    ),
  });
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
