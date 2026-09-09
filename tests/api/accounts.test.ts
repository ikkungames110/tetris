import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { completedSprint as completed } from '../helpers/sprint';
import type { AccountState } from '../../packages/protocol/account';
import { saveMatchResult } from '../../apps/api/ratings';
import {
  handshake,
  parseServerMessage,
  type ServerMessage,
  type RoomState,
} from '../../packages/protocol/online';
import fixture from '../fixtures/sprint-clear.json' with { type: 'json' };

let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
const password = 'test-only-password-456';
const base = 'https://stack.test';
const post = (path: string, body: unknown = {}, cookie = '', extra: Record<string, string> = {}) =>
  mf.dispatchFetch(`${base}/api/v1/${path}`, {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      Cookie: cookie,
      'CF-Connecting-IP': randomUUID(),
      ...extra,
    },
    body: JSON.stringify(body),
  });
async function guest() {
  const response = await post('session');
  assert.equal(response.status, 200);
  return {
    state: (await response.json()) as AccountState,
    cookie: response.headers.get('Set-Cookie')!.split(';')[0],
  };
}
async function register() {
  const initial = await guest();
  const email = `${randomUUID()}@example.test`;
  const response = await post('register', { email, password }, initial.cookie);
  assert.equal(response.status, 200);
  return {
    email,
    cookie: response.headers.get('Set-Cookie')!.split(';')[0],
    state: (await response.json()) as AccountState,
    initial,
  };
}
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'api',
      modules: true,
      scriptPath: '.api-build/index.js',
      compatibilityDate: '2026-09-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      durableObjects: { RANDOM_ROOMS: { className: 'RandomRoom', useSQLite: true } },
    }),
  );
  db = await mf.getD1Database('DB');
  const directory = 'apps/api/migrations';
  const sql = (
    await Promise.all(
      (await readdir(directory))
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => readFile(`${directory}/${file}`, 'utf8')),
    )
  ).join('\n');
  await db.batch(
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
});
after(async () => {
  await mf?.dispose();
});

test('guest session persists with an HttpOnly secure cookie and no cached identity', async () => {
  const response = await post('session');
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('Set-Cookie')!,
    /^__Host-stack_session=.*HttpOnly; SameSite=Strict;.*Secure/,
  );
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const state = (await response.json()) as AccountState;
  assert.equal(state.user.kind, 'guest');
  assert.equal(state.user.email, null);
  const again = await post('session', {}, response.headers.get('Set-Cookie')!.split(';')[0]);
  assert.deepEqual(await again.json(), state);
  assert.equal(again.headers.get('Set-Cookie'), null);
});

test('registration rotates sessions, hashes passwords, login normalizes email and logout revokes access', async () => {
  const user = await register();
  assert.equal(user.state.user.kind, 'member');
  assert.notEqual(user.cookie, user.initial.cookie);
  const row = await db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.state.user.id)
    .first<{ password_hash: string }>();
  assert.match(row!.password_hash, /^scrypt:16384:8:5:/);
  assert.ok(!row!.password_hash.includes(password));
  assert.equal(
    (await mf.dispatchFetch(`${base}/api/v1/me`, { headers: { Cookie: user.initial.cookie } }))
      .status,
    401,
  );
  const denied = await post('login', { email: user.email, password: 'a-wrong-password' });
  assert.equal(denied.status, 401);
  const missing = await post('login', {
    email: 'missing@example.test',
    password: 'a-wrong-password',
  });
  assert.deepEqual(await denied.json(), await missing.json());
  const login = await post('login', { email: ` ${user.email.toUpperCase()} `, password });
  assert.equal(login.status, 200);
  assert.deepEqual(((await login.json()) as AccountState).user, user.state.user);
  const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
  const logout = await post('logout', {}, cookie);
  assert.equal(((await logout.json()) as AccountState).user.kind, 'guest');
  assert.equal(
    (await mf.dispatchFetch(`${base}/api/v1/me`, { headers: { Cookie: cookie } })).status,
    401,
  );
});

test('sprint is verified, guest best transfers on registration, slower and concurrent results cannot overwrite it', async () => {
  const initial = await guest();
  const save = await post(
    'records/40line',
    { userId: initial.state.user.id, replay: completed() },
    initial.cookie,
  );
  assert.equal(save.status, 200);
  const saved = (await save.json()) as AccountState;
  assert.equal(saved.best40?.ticks, fixture.roundTicks);
  const email = `${randomUUID()}@example.test`;
  const response = await post('register', { email, password }, initial.cookie);
  assert.equal(response.status, 200);
  const state = (await response.json()) as AccountState;
  assert.deepEqual(state.best40, saved.best40);
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
  const results = await Promise.all(
    [0, 30, 60].map((extra) =>
      post('records/40line', { userId: state.user.id, replay: completed(extra) }, cookie),
    ),
  );
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.deepEqual(((await result.json()) as AccountState).best40, saved.best40);
  }
  const elsewhere = await post('login', { email, password });
  assert.deepEqual(((await elsewhere.json()) as AccountState).best40, saved.best40);
  assert.equal((await guest()).state.best40, null);
});

test('incomplete, tampered, wrong-mode and another account submissions are rejected', async () => {
  const user = await guest();
  const replay = completed();
  for (const invalid of [
    { ...replay, finalHash: '00000000' },
    { ...replay, mode: 'practice' },
    { ...replay, rounds: [[]] },
  ])
    assert.equal(
      (await post('records/40line', { userId: user.state.user.id, replay: invalid }, user.cookie))
        .status,
      400,
    );
  assert.equal(
    (await post('records/40line', { userId: 'somebody-else', replay }, user.cookie)).status,
    409,
  );
  assert.equal((await post('records/40line', { userId: user.state.user.id, replay })).status, 401);
  const me = await mf.dispatchFetch(`${base}/api/v1/me`, { headers: { Cookie: user.cookie } });
  assert.equal(((await me.json()) as AccountState).best40, null);
});

test('one-character passwords work; empty and overlong passwords are rejected', async () => {
  for (const password of ['a', 'あ', 'x'.repeat(128)]) {
    const initial = await guest();
    const email = `${randomUUID()}@example.test`;
    const response = await post('register', { email, password }, initial.cookie);
    assert.equal(response.status, 200);
    const account = (await response.json()) as AccountState;
    const login = await post('login', { email, password });
    assert.equal(login.status, 200);
    assert.equal(((await login.json()) as AccountState).user.id, account.user.id);
  }
  const initial = await guest();
  for (const password of ['', 'x'.repeat(129)])
    assert.equal(
      (await post('register', { email: `${randomUUID()}@example.test`, password }, initial.cookie))
        .status,
      400,
    );
});

test('cross-origin writes, invalid bodies and expired sessions are rejected', async () => {
  assert.equal((await post('session', {}, '', { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post('session', {}, '', { Origin: '' })).status, 403);
  assert.equal((await post('session', {}, '', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('register', { email: 'x@example.test', password: '' })).status, 400);
  assert.equal((await post('login', {}, '', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('login', { password: 'x'.repeat(5000) })).status, 413);
  const user = await guest();
  await db
    .prepare('UPDATE sessions SET expires_at = 0 WHERE user_id = ?')
    .bind(user.state.user.id)
    .run();
  assert.equal(
    (await mf.dispatchFetch(`${base}/api/v1/me`, { headers: { Cookie: user.cookie } })).status,
    401,
  );
  const fresh = await post('session', {}, user.cookie);
  assert.notEqual(((await fresh.json()) as AccountState).user.id, user.state.user.id);
});

test('duplicate and concurrent registrations cannot overwrite credentials or expose another account', async () => {
  const user = await register();
  const initial = await guest();
  assert.equal(
    (await post('register', { email: user.email, password }, initial.cookie)).status,
    409,
  );
  const concurrent = await guest();
  const emails = [0, 1].map(() => `${randomUUID()}@example.test`);
  const responses = await Promise.all(
    emails.map((email) => post('register', { email, password }, concurrent.cookie)),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE email IN (?, ?)')
    .bind(...emails)
    .first<{ n: number }>();
  assert.equal(count!.n, 1);
});

test('repeated authentication attempts are rate limited before password work', async () => {
  const headers = { 'CF-Connecting-IP': 'rate-limit-test' };
  for (let i = 0; i < 30; i++) assert.equal((await post('login', {}, '', headers)).status, 400);
  assert.equal((await post('login', {}, '', headers)).status, 429);
});

test('scheduled cleanup removes expired guests and sessions while preserving members', async () => {
  const initial = await guest();
  const member = await register();
  const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
  for (const id of [initial.state.user.id, member.state.user.id]) {
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').bind(old, id).run();
    await db.prepare('UPDATE sessions SET expires_at = 0 WHERE user_id = ?').bind(id).run();
  }
  await db
    .prepare("INSERT INTO rate_limits (key_hash, attempts, expires_at) VALUES ('expired', 1, 0)")
    .run();
  const worker = await mf.getWorker('api');
  await worker.scheduled();
  assert.equal(
    await db.prepare('SELECT id FROM users WHERE id = ?').bind(initial.state.user.id).first(),
    null,
  );
  assert.ok(
    await db.prepare('SELECT id FROM users WHERE id = ?').bind(member.state.user.id).first(),
  );
  assert.equal(
    await db.prepare("SELECT key_hash FROM rate_limits WHERE key_hash = 'expired'").first(),
    null,
  );
});

test('random results persist, deduplicate concurrent submissions and follow registration/login', async () => {
  const initial = await guest();
  const opponent = await guest();
  const result = { userId: initial.state.user.id, matchId: randomUUID(), seat: 1, wins: [0, 2] };
  const players = [
    { id: opponent.state.user.id, rating: null },
    { id: initial.state.user.id, rating: null },
  ] as const;
  await saveMatchResult(db as never, { matchId: result.matchId, winner: 1, players: [...players] });
  const responses = await Promise.all(
    Array.from({ length: 3 }, () => post('records/random', result, initial.cookie)),
  );
  for (const response of responses) assert.equal(response.status, 200);
  const lossId = randomUUID();
  await saveMatchResult(db as never, { matchId: lossId, winner: 0, players: [...players] });
  const loss = await post(
    'records/random',
    { ...result, matchId: lossId, wins: [2, 1] },
    initial.cookie,
  );
  assert.deepEqual(((await loss.json()) as AccountState).randomStats, { matches: 2, wins: 1 });
  const email = `${randomUUID()}@example.test`;
  const registered = await post('register', { email, password }, initial.cookie);
  const state = (await registered.json()) as AccountState;
  assert.equal(registered.status, 200);
  assert.deepEqual(state.randomStats, { matches: 2, wins: 1 });
  const login = await post('login', { email, password });
  assert.deepEqual(((await login.json()) as AccountState).randomStats, state.randomStats);
  const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
  const retry = await post('records/random', { ...result, userId: state.user.id }, cookie);
  assert.deepEqual(((await retry.json()) as AccountState).randomStats, state.randomStats);
  const another = await guest();
  assert.deepEqual(another.state.randomStats, { matches: 0, wins: 0 });
});

test('random results require the current identity and a completed two-win match', async () => {
  const initial = await guest();
  const result = { userId: initial.state.user.id, matchId: randomUUID(), seat: 0, wins: [2, 1] };
  assert.equal((await post('records/random', result)).status, 401);
  assert.equal((await post('records/random', result, initial.cookie)).status, 409);
  assert.equal(
    (await post('records/random', { ...result, userId: randomUUID() }, initial.cookie)).status,
    409,
  );
  for (const invalid of [
    { wins: [1, 0] },
    { wins: [2, 2] },
    { wins: [2, -1] },
    { seat: 2 },
    { matchId: '' },
  ])
    assert.equal(
      (await post('records/random', { ...result, ...invalid }, initial.cookie)).status,
      400,
    );
  const response = await post('session', {}, initial.cookie);
  assert.deepEqual(((await response.json()) as AccountState).randomStats, { matches: 0, wins: 0 });
});

test('member ratings start at 1000, settle atomically once, retain their peaks and survive login', async () => {
  const a = await register(),
    b = await register();
  assert.deepEqual(a.state.rating, { current: 1000, peak: 1000, matches: 0 });
  const result = {
    matchId: randomUUID(),
    winner: 0,
    players: [
      { id: a.state.user.id, rating: 1000 },
      { id: b.state.user.id, rating: 1000 },
    ] as [{ id: string; rating: number }, { id: string; rating: number }],
  };
  const saved = await Promise.all(
    Array.from({ length: 4 }, () => saveMatchResult(db as never, result)),
  );
  for (const value of saved) assert.deepEqual(value.changes, [24, -24]);
  const read = async (cookie: string) =>
    (await (await post('session', {}, cookie)).json()) as AccountState;
  assert.deepEqual((await read(a.cookie)).rating, { current: 1024, peak: 1024, matches: 1 });
  assert.deepEqual((await read(b.cookie)).rating, { current: 976, peak: 1000, matches: 1 });
  await saveMatchResult(db as never, {
    ...result,
    matchId: randomUUID(),
    winner: 1,
    players: [
      { id: a.state.user.id, rating: 1024 },
      { id: b.state.user.id, rating: 976 },
    ],
  });
  const state = await read(a.cookie);
  assert.equal(state.rating?.current, 998);
  assert.equal(state.rating?.peak, 1024);
  assert.deepEqual(state.randomStats, { matches: 2, wins: 1 });
  const login = await post('login', { email: a.email, password });
  assert.deepEqual(((await login.json()) as AccountState).rating, state.rating);
});

test('guest matches never change either rating, and losses cannot go below zero', async () => {
  const a = await register(),
    b = await guest();
  for (const winner of [0, 1]) {
    const result = await saveMatchResult(db as never, {
      matchId: randomUUID(),
      winner,
      players: [
        { id: a.state.user.id, rating: 1000 },
        { id: b.state.user.id, rating: null },
      ],
    });
    assert.equal(result.rated, false);
    assert.deepEqual(result.changes, [0, 0]);
  }
  const state = (await (await post('session', {}, a.cookie)).json()) as AccountState;
  assert.deepEqual(state.rating, { current: 1000, peak: 1000, matches: 0 });
  const c = await register();
  await db.prepare('UPDATE users SET rating = 2 WHERE id = ?').bind(c.state.user.id).run();
  const result = await saveMatchResult(db as never, {
    matchId: randomUUID(),
    winner: 0,
    players: [
      { id: a.state.user.id, rating: 1000 },
      { id: c.state.user.id, rating: 2 },
    ],
  });
  assert.equal(result.ratings[1], 0);
  assert.equal(result.changes[1], -2);
});

test('a failed rating transaction rolls back both players and can be retried', async () => {
  const a = await register(),
    b = await register();
  const result = {
    matchId: randomUUID(),
    winner: 0,
    players: [
      { id: a.state.user.id, rating: 1000 },
      { id: b.state.user.id, rating: 1000 },
    ] as [{ id: string; rating: number }, { id: string; rating: number }],
  };
  await db
    .prepare(
      "CREATE TRIGGER fail_rating BEFORE UPDATE OF rating ON users BEGIN SELECT RAISE(ABORT, 'test DB failure'); END",
    )
    .run();
  try {
    await assert.rejects(saveMatchResult(db as never, result));
    for (const user of [a, b]) {
      const state = (await (await post('session', {}, user.cookie)).json()) as AccountState;
      assert.deepEqual(state.rating, { current: 1000, peak: 1000, matches: 0 });
      assert.deepEqual(state.randomStats, { matches: 0, wins: 0 });
    }
  } finally {
    await db.prepare('DROP TRIGGER fail_rating').run();
  }
  assert.deepEqual((await saveMatchResult(db as never, result)).changes, [24, -24]);
});

test('random socket upgrades reject cross-origin and incompatible clients', async () => {
  const path = `${base}/api/v1/random/ABC234?version=${handshake.version}&rules=${handshake.rules}`;
  const rejected = await mf.dispatchFetch(path, {
    headers: { Origin: 'https://other.test', Upgrade: 'websocket' },
  });
  assert.equal(rejected.status, 403);
  const old = await mf.dispatchFetch(path.replace(`version=${handshake.version}`, 'version=0'), {
    headers: { Origin: base, Upgrade: 'websocket' },
  });
  assert.equal(old.status, 409);
});

test('the authoritative room matches a 400-point gap and ignores forged guest identity headers', async () => {
  const a = await register(),
    b = await register();
  await db
    .prepare('UPDATE users SET rating = 1400, peak_rating = 1400 WHERE id = ?')
    .bind(b.state.user.id)
    .run();
  const code = Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32],
  ).join('');
  const connect = async (cookie: string, host: boolean, roomCode = code) => {
    const response = await mf.dispatchFetch(
      `${base}/api/v1/random/${roomCode}?host=${host ? 1 : 0}&version=${handshake.version}&rules=${handshake.rules}`,
      {
        headers: {
          Origin: base,
          Upgrade: 'websocket',
          Cookie: cookie,
          'X-Stack-Player': JSON.stringify({ id: a.state.user.id, rating: 99999 }),
        },
      },
    );
    assert.equal(response.status, 101);
    const socket = response.webSocket!;
    const messages: ServerMessage[] = [];
    const subscribers = new Set<() => void>();
    socket.addEventListener('message', (event) => {
      const message = parseServerMessage(String(event.data));
      if (message) messages.push(message);
      for (const callback of subscribers) callback();
    });
    socket.accept();
    const waitFor = (predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          subscribers.delete(check);
          reject(new Error('No room response'));
        }, 4000);
        const check = () => {
          const message = messages.find(predicate);
          if (message) {
            clearTimeout(timer);
            subscribers.delete(check);
            resolve(message);
          }
        };
        subscribers.add(check);
        check();
      });
    const initial = (await waitFor((m) => m.type === 'room')) as RoomState;
    return {
      socket,
      waitFor,
      ready: () =>
        socket.send(JSON.stringify({ type: 'ready', matchId: initial.matchId, round: 0 })),
    };
  };
  const first = await connect(a.cookie, true),
    second = await connect(b.cookie, false);
  try {
    const room = (await first.waitFor(
      (m) => m.type === 'room' && m.connected.every(Boolean),
    )) as RoomState;
    assert.deepEqual(room.ratings, [1000, 1400]);
    first.ready();
    second.ready();
    await first.waitFor((m) => m.type === 'room' && m.match?.phase === 'countdown');
    second.socket.close();
    const result = await first.waitFor((m) => m.type === 'rating');
    assert.equal(result.type, 'rating');
    if (result.type === 'rating') assert.deepEqual(result.changes, [34, -34]);
  } finally {
    if (first.socket.readyState === 1) first.socket.close();
    if (second.socket.readyState === 1) second.socket.close();
  }
  // No cookie still permits play, but even a forged account header stays a guest.
  const guestRoom = await connect('', true, code.slice(0, 5) + (code[5] === 'A' ? 'B' : 'A'));
  try {
    const room = (await guestRoom.waitFor((m) => m.type === 'room')) as RoomState;
    assert.deepEqual(room.ratings, [null, null]);
  } finally {
    guestRoom.socket.close();
  }
});
