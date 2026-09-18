import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { completedSprint as completed } from '../helpers/sprint';
import type { AccountState } from '../../packages/protocol/account';
import { saveMatchResult } from '../../apps/api/ratings';
import { handshake } from '../../packages/protocol/online';
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
  const username = `${randomUUID()}`;
  const response = await post('register', { username, password }, initial.cookie);
  assert.equal(response.status, 200);
  return {
    username,
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
      d1Databases: ['DB', 'LEGACY', 'REPORT_MIGRATION'],
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

test('rankings include indexed top tens and own ranks with ties, and expose only public names', async () => {
  const initial = await guest();
  assert.deepEqual(initial.state.rankings, {
    sprint: { top: [], mine: null },
    random: { top: [], mine: null },
  });
  const owner = await register();
  const ids = Array.from({ length: 12 }, (_, i) => `ranking-${String(i).padStart(2, '0')}`);
  try {
    for (const [i, id] of ids.entries()) {
      await db
        .prepare(
          `INSERT INTO users (id, kind, username, password_hash, created_at, updated_at, rating, peak_rating)
        VALUES (?, 'member', ?, 'unused-test-hash', 1, 1, ?, ?)`,
        )
        .bind(id, id, 2000 - Math.max(0, i - 1) * 10, 2000)
        .run();
      await db
        .prepare("INSERT INTO personal_bests VALUES (?, 'sprint', ?, ?)")
        .bind(id, 100 + Math.max(0, i - 1) * 10, i)
        .run();
    }
    await db
      .prepare("INSERT INTO personal_bests VALUES (?, 'sprint', 400, 1)")
      .bind(owner.state.user.id)
      .run();
    await db
      .prepare("INSERT INTO personal_bests VALUES (?, 'sprint', 50, 1)")
      .bind(initial.state.user.id)
      .run();
    // Guests with even a high stored value must not appear in rate rankings.
    await db
      .prepare('UPDATE users SET rating = 9999, peak_rating = 9999 WHERE id = ?')
      .bind(initial.state.user.id)
      .run();
    const response = await post('session', {}, owner.cookie);
    const state = (await response.json()) as AccountState;
    const ranking = state.rankings!;
    assert.equal(ranking.sprint.top.length, 10);
    assert.equal(ranking.random.top.length, 10);
    assert.deepEqual(
      ranking.sprint.top.map((row) => row.rank),
      [1, 2, 2, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.deepEqual(
      ranking.random.top.map((row) => row.rank),
      [1, 1, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.deepEqual(ranking.sprint.mine, { rank: 14, value: 400 });
    assert.deepEqual(ranking.random.mine, { rank: 13, value: 1000 });
    assert.ok(!JSON.stringify(ranking).includes('@'));
    for (const row of [...ranking.sprint.top, ...ranking.random.top])
      assert.deepEqual(Object.keys(row).sort(), ['isYou', 'name', 'rank', 'value']);
    const guestState = (await (await post('session', {}, initial.cookie)).json()) as AccountState;
    assert.deepEqual(guestState.rankings!.sprint.mine, { rank: 1, value: 50 });
    assert.equal(guestState.rankings!.sprint.top[0].isYou, true);
    assert.equal(guestState.rankings!.random.mine, null);
    await db
      .prepare('UPDATE personal_bests SET ticks = 50 WHERE user_id = ?')
      .bind(owner.state.user.id)
      .run();
    await db
      .prepare('UPDATE users SET rating = 2000, peak_rating = 2000 WHERE id = ?')
      .bind(owner.state.user.id)
      .run();
    const login = (await (
      await post('login', { username: owner.username, password }, owner.cookie)
    ).json()) as AccountState;
    assert.deepEqual(login.rankings!.sprint.mine, { rank: 1, value: 50 });
    assert.deepEqual(login.rankings!.random.mine, { rank: 1, value: 2000 });
    assert.equal(login.rankings!.sprint.top.filter((row) => row.isYou).length, 1);
    assert.equal(login.rankings!.random.top.filter((row) => row.isYou).length, 1);
    const saved = (await (
      await post(
        'records/40line',
        { userId: initial.state.user.id, replay: completed() },
        initial.cookie,
      )
    ).json()) as AccountState;
    assert.equal(saved.rankings, undefined);
    assert.equal(
      ((await (await post('logout', {}, initial.cookie)).json()) as AccountState).rankings,
      undefined,
    );
    for (const [sql, index] of [
      [
        "SELECT ticks FROM personal_bests WHERE mode = 'sprint' ORDER BY ticks, achieved_at, user_id LIMIT 10",
        'personal_bests_ranking',
      ],
      [
        "SELECT rating FROM users WHERE kind = 'member' ORDER BY rating DESC, id LIMIT 10",
        'users_rating_ranking',
      ],
      [
        "SELECT COUNT(*) FROM personal_bests WHERE mode = 'sprint' AND ticks < 400",
        'personal_bests_ranking',
      ],
      [
        "SELECT COUNT(*) FROM users WHERE kind = 'member' AND rating > 1000",
        'users_rating_ranking',
      ],
    ]) {
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>();
      assert.ok(
        plan.results.some((row) => row.detail.includes(index)),
        JSON.stringify(plan.results),
      );
    }
  } finally {
    for (const id of [...ids, owner.state.user.id, initial.state.user.id])
      await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  }
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
  assert.equal(state.user.username, null);
  const again = await post('session', {}, response.headers.get('Set-Cookie')!.split(';')[0]);
  assert.deepEqual(await again.json(), state);
  assert.equal(again.headers.get('Set-Cookie'), null);
});

test('registration rotates sessions, hashes passwords, login normalizes username and logout revokes access', async () => {
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
  const denied = await post('login', { username: user.username, password: 'a-wrong-password' });
  assert.equal(denied.status, 401);
  const missing = await post('login', {
    username: 'missing',
    password: 'a-wrong-password',
  });
  assert.deepEqual(await denied.json(), await missing.json());
  const login = await post('login', { username: ` ${user.username.toUpperCase()} `, password });
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
  const username = `${randomUUID()}`;
  const response = await post('register', { username, password }, initial.cookie);
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
  const elsewhere = await post('login', { username, password });
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
    const username = `${randomUUID()}`;
    const response = await post('register', { username, password }, initial.cookie);
    assert.equal(response.status, 200);
    const account = (await response.json()) as AccountState;
    const login = await post('login', { username, password });
    assert.equal(login.status, 200);
    assert.equal(((await login.json()) as AccountState).user.id, account.user.id);
  }
  const initial = await guest();
  for (const password of ['', 'x'.repeat(129)])
    assert.equal(
      (await post('register', { username: `${randomUUID()}`, password }, initial.cookie)).status,
      400,
    );
});

test('cross-origin writes, invalid bodies and expired sessions are rejected', async () => {
  assert.equal((await post('session', {}, '', { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post('session', {}, '', { Origin: '' })).status, 403);
  assert.equal((await post('session', {}, '', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('register', { username: 'x', password: '' })).status, 400);
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
    (await post('register', { username: user.username, password }, initial.cookie)).status,
    409,
  );
  const concurrent = await guest();
  const usernames = [0, 1].map(() => `${randomUUID()}`);
  const responses = await Promise.all(
    usernames.map((username) => post('register', { username, password }, concurrent.cookie)),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE username IN (?, ?)')
    .bind(...usernames)
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
  const result = { userId: initial.state.user.id, matchId: randomUUID(), seat: 1, wins: [0, 3] };
  assert.equal(
    (
      await post(
        'records/random',
        {
          ...result,
          userId: opponent.state.user.id,
          seat: 0,
        },
        opponent.cookie,
      )
    ).status,
    202,
  );
  const responses = await Promise.all(
    Array.from({ length: 3 }, () => post('records/random', result, initial.cookie)),
  );
  for (const response of responses) assert.equal(response.status, 200);
  const lossId = randomUUID();
  await post(
    'records/random',
    {
      userId: opponent.state.user.id,
      matchId: lossId,
      seat: 0,
      wins: [3, 1],
    },
    opponent.cookie,
  );
  const loss = await post(
    'records/random',
    { ...result, matchId: lossId, wins: [3, 1] },
    initial.cookie,
  );
  assert.deepEqual(((await loss.json()) as AccountState).randomStats, { matches: 2, wins: 1 });
  const username = `${randomUUID()}`;
  const registered = await post('register', { username, password }, initial.cookie);
  const state = (await registered.json()) as AccountState;
  assert.equal(registered.status, 200);
  assert.deepEqual(state.randomStats, { matches: 2, wins: 1 });
  const login = await post('login', { username, password });
  assert.deepEqual(((await login.json()) as AccountState).randomStats, state.randomStats);
  const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
  const retry = await post('records/random', { ...result, userId: state.user.id }, cookie);
  assert.deepEqual(((await retry.json()) as AccountState).randomStats, state.randomStats);
  const another = await guest();
  assert.deepEqual(another.state.randomStats, { matches: 0, wins: 0 });
});

test('random results require the current identity and a completed three-win match', async () => {
  const initial = await guest();
  const result = { userId: initial.state.user.id, matchId: randomUUID(), seat: 0, wins: [3, 1] };
  assert.equal((await post('records/random', result)).status, 401);
  assert.equal((await post('records/random', result, initial.cookie)).status, 202);
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
  const login = await post('login', { username: a.username, password });
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

test('retired random WebSockets never start a Durable Object', async () => {
  const response = await mf.dispatchFetch(`${base}/api/v1/random/ABC234`, {
    headers: { Origin: base, Upgrade: 'websocket' },
  });
  assert.equal(response.status, 410);
});

test('P2P reports require both identities, matching winners and settle concurrently exactly once', async () => {
  const a = await register(),
    b = await register(),
    outsider = await guest();
  const matchId = randomUUID();
  const first = { userId: a.state.user.id, matchId, seat: 0, wins: [3, 1] };
  const second = { userId: b.state.user.id, matchId, seat: 1, wins: [3, 0] };
  const waiting = await post('records/random', first, a.cookie);
  assert.equal(waiting.status, 202);
  assert.equal(((await waiting.json()) as AccountState).randomPending, true);
  assert.equal((await post('records/random', { ...first, seat: 1 }, a.cookie)).status, 409);
  assert.equal(
    (await post('records/random', { ...first, userId: outsider.state.user.id }, outsider.cookie))
      .status,
    409,
  );
  assert.equal((await post('records/random', { ...first, wins: [0, 3] }, a.cookie)).status, 409);
  const responses = await Promise.all([
    post('records/random', second, b.cookie),
    post('records/random', second, b.cookie),
    post('records/random', first, a.cookie),
  ]);
  for (const response of responses) assert.ok([200, 202].includes(response.status));
  const settled = await post('records/random', first, a.cookie);
  const state = (await settled.json()) as AccountState;
  assert.equal(settled.status, 200);
  assert.deepEqual(state.randomResult?.changes, [24, -24]);
  assert.deepEqual(state.rating, { current: 1024, peak: 1024, matches: 1 });
  const loser = (await (await post('records/random', second, b.cookie)).json()) as AccountState;
  assert.deepEqual(loser.rating, { current: 976, peak: 1000, matches: 1 });
  assert.deepEqual(loser.randomStats, { matches: 1, wins: 0 });
});

test('conflicting P2P reports use the first outcome and late reports cannot change it', async () => {
  const a = await register(),
    b = await register();
  const matchId = randomUUID();
  const first = { userId: a.state.user.id, matchId, seat: 0, wins: [3, 1] };
  const second = { userId: b.state.user.id, matchId, seat: 1, wins: [1, 3] };
  assert.equal((await post('records/random', first, a.cookie)).status, 202);
  await db
    .prepare('UPDATE random_reports SET created_at = created_at - 1 WHERE match_id = ?')
    .bind(matchId)
    .run();
  assert.equal((await post('records/random', second, b.cookie)).status, 200);
  const state = (await (await post('records/random', first, a.cookie)).json()) as AccountState;
  assert.equal(state.randomResult?.winner, 0);
  assert.equal(state.rating?.current, 1024);
  const late = (await (
    await post('records/random', { ...second, wins: [3, 1] }, b.cookie)
  ).json()) as AccountState;
  assert.equal(late.randomResult?.winner, 0);
  assert.deepEqual(late.rating, { current: 976, peak: 1000, matches: 1 });
});

for (const reportedWinner of [0, 1])
  test(`a sole report wins after five seconds even when reporting winner ${reportedWinner}`, async () => {
    const a = await register(),
      b = await register();
    const matchId = randomUUID();
    const first = {
      userId: a.state.user.id,
      opponentId: b.state.user.id,
      matchId,
      seat: 0,
      wins: reportedWinner === 0 ? [3, 0] : [0, 3],
    };
    assert.equal((await post('records/random', first, a.cookie)).status, 202);
    assert.equal((await post('records/random', first, a.cookie)).status, 202);
    await db
      .prepare('UPDATE random_reports SET created_at = created_at - 6000 WHERE match_id = ?')
      .bind(matchId)
      .run();
    const responses = await Promise.all([
      post('records/random', first, a.cookie),
      post('records/random', first, a.cookie),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      const state = (await response.json()) as AccountState;
      assert.equal(state.randomResult?.winner, 0);
      assert.deepEqual(state.randomStats, { matches: 1, wins: 1 });
      assert.deepEqual(state.rating, { current: 1024, peak: 1024, matches: 1 });
    }
    const loser = (await (await post('session', {}, b.cookie)).json()) as AccountState;
    assert.deepEqual(loser.rating, { current: 976, peak: 1000, matches: 1 });
    assert.deepEqual(loser.randomStats, { matches: 1, wins: 0 });
    const late = await post(
      'records/random',
      { ...first, userId: b.state.user.id, opponentId: a.state.user.id, seat: 1, wins: [0, 3] },
      b.cookie,
    );
    assert.equal(late.status, 200);
    assert.equal(((await late.json()) as AccountState).randomResult?.winner, 0);
  });

test('a counterpart arriving after the deadline cannot undo the sole reporter win before recovery runs', async () => {
  const a = await register(),
    b = await register();
  const matchId = randomUUID();
  await post(
    'records/random',
    { userId: a.state.user.id, opponentId: b.state.user.id, matchId, seat: 0, wins: [0, 3] },
    a.cookie,
  );
  await db
    .prepare('UPDATE random_reports SET created_at = created_at - 6000 WHERE match_id = ?')
    .bind(matchId)
    .run();
  const response = await post(
    'records/random',
    { userId: b.state.user.id, opponentId: a.state.user.id, matchId, seat: 1, wins: [0, 3] },
    b.cookie,
  );
  const state = (await response.json()) as AccountState;
  assert.equal(response.status, 200);
  assert.equal(state.randomResult?.winner, 0);
  assert.deepEqual(state.rating, { current: 976, peak: 1000, matches: 1 });
});

test('scheduled recovery settles a lone guest report after the browser closes', async () => {
  const a = await guest(),
    b = await register();
  const matchId = randomUUID();
  const first = {
    userId: a.state.user.id,
    opponentId: b.state.user.id,
    matchId,
    seat: 1,
    wins: [0, 3],
  };
  assert.equal((await post('records/random', first, a.cookie)).status, 202);
  await db
    .prepare('UPDATE random_reports SET created_at = created_at - 6000 WHERE match_id = ?')
    .bind(matchId)
    .run();
  const worker = await mf.getWorker('api');
  await worker.scheduled({ cron: '* * * * *' });
  const state = (await (await post('session', {}, a.cookie)).json()) as AccountState;
  assert.deepEqual(state.randomStats, { matches: 1, wins: 1 });
  const loser = (await (await post('session', {}, b.cookie)).json()) as AccountState;
  assert.deepEqual(loser.randomStats, { matches: 1, wins: 0 });
  assert.deepEqual(loser.rating, { current: 1000, peak: 1000, matches: 0 });
});

test('a frozen decision survives failed rating writes and scheduled retries apply it once', async () => {
  const a = await register(),
    b = await register();
  const matchId = randomUUID();
  const first = {
    userId: a.state.user.id,
    opponentId: b.state.user.id,
    matchId,
    seat: 0,
    wins: [3, 0],
  };
  await post('records/random', first, a.cookie);
  await db
    .prepare('UPDATE random_reports SET created_at = created_at - 6000 WHERE match_id = ?')
    .bind(matchId)
    .run();
  await db
    .prepare(
      "CREATE TRIGGER fail_settlement BEFORE UPDATE OF rating ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    )
    .run();
  try {
    assert.equal((await post('records/random', first, a.cookie)).status, 500);
    assert.equal(
      (
        await db
          .prepare('SELECT winner FROM random_decisions WHERE match_id = ?')
          .bind(matchId)
          .first()
      )?.winner,
      0,
    );
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM random_results WHERE match_id = ?')
          .bind(matchId)
          .first()
      )?.n,
      0,
    );
  } finally {
    await db.prepare('DROP TRIGGER fail_settlement').run();
  }
  const worker = await mf.getWorker('api');
  await worker.scheduled({ cron: '* * * * *' });
  await worker.scheduled({ cron: '* * * * *' });
  const state = (await (await post('session', {}, a.cookie)).json()) as AccountState;
  assert.deepEqual(state.rating, { current: 1024, peak: 1024, matches: 1 });
});

test('decision migration preserves already settled outcomes and leaves pending reports recoverable', async () => {
  const legacy = await mf.getD1Database('REPORT_MIGRATION');
  const apply = async (sql: string) =>
    legacy.batch(
      sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => legacy.prepare(s)),
    );
  await apply(`CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE random_results (user_id TEXT, match_id TEXT, won INTEGER);
    INSERT INTO users VALUES ('a'), ('b');`);
  await apply(await readFile('apps/api/migrations/0007_random_reports.sql', 'utf8'));
  await apply(`INSERT INTO random_reports VALUES ('done', 0, 'a', 1, 1000, 1), ('done', 1, 'b', 1, 1200, 2), ('pending', 0, 'a', 0, 1000, 3);
    INSERT INTO random_results VALUES ('a', 'done', 0), ('b', 'done', 1);`);
  await apply(await readFile('apps/api/migrations/0008_random_decisions.sql', 'utf8'));
  assert.deepEqual(
    await legacy.prepare("SELECT * FROM random_decisions WHERE match_id = 'done'").first(),
    {
      match_id: 'done',
      winner: 1,
      player0: 'a',
      player1: 'b',
      rating0: 1000,
      rating1: 1200,
      applied: 1,
    },
  );
  assert.equal(
    (
      await legacy
        .prepare("SELECT SUM(finalized) AS n FROM random_reports WHERE match_id = 'done'")
        .first()
    )?.n,
    2,
  );
  assert.equal(
    (
      await legacy
        .prepare("SELECT finalized FROM random_reports WHERE match_id = 'pending'")
        .first()
    )?.finalized,
    0,
  );
});

test('username changes preserve identity and records, reject duplicates and change login credentials', async () => {
  const owner = await register();
  const other = await register();
  const initial = await guest();
  assert.equal((await post('username', { username: 'new-name' })).status, 401);
  assert.equal((await post('username', { username: 'new-name' }, initial.cookie)).status, 401);
  for (const username of ['', 'a'.repeat(41), 'has space', 'has@sign', 'control\u0000']) {
    assert.equal((await post('username', { username }, owner.cookie)).status, 400);
    assert.equal((await post('register', { username, password }, initial.cookie)).status, 400);
  }
  assert.equal(
    (await post('username', { username: other.username.toUpperCase() }, owner.cookie)).status,
    409,
  );
  await post('records/40line', { userId: owner.state.user.id, replay: completed() }, owner.cookie);
  const username = `日本語-${randomUUID().slice(0, 8)}`;
  const response = await post('username', { username: ` ${username} ` }, owner.cookie);
  assert.equal(response.status, 200);
  const state = (await response.json()) as AccountState;
  assert.equal(state.user.id, owner.state.user.id);
  assert.equal(state.user.username, username);
  assert.ok(state.best40);
  assert.deepEqual(state.rating, owner.state.rating);
  assert.equal(state.rankings!.sprint.top.find((row) => row.isYou)?.name, username);
  assert.equal((await post('login', { username: owner.username, password })).status, 401);
  const login = await post('login', { username, password });
  assert.equal(login.status, 200);
  assert.equal(((await login.json()) as AccountState).user.id, owner.state.user.id);
  const restored = await post('session', {}, owner.cookie);
  assert.equal(((await restored.json()) as AccountState).user.username, username);
  assert.equal((await post('username', { username }, owner.cookie)).status, 200);
});

test('legacy migration preserves sessions and records and assigns unique names without emails', async () => {
  const legacy = await mf.getD1Database('LEGACY');
  const applySql = async (sql: string) =>
    legacy.batch(
      sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => legacy.prepare(s)),
    );
  for (const file of [
    '0001_accounts.sql',
    '0002_random_results.sql',
    '0003_ratings.sql',
    '0004_rankings.sql',
  ])
    await applySql(await readFile(`apps/api/migrations/${file}`, 'utf8'));
  const ids = Array.from({ length: 5 }, () => randomUUID());
  for (const [i, email] of [
    'alice@example.test',
    'same@one.test',
    'same@two.test',
    'player-reserved@example.test',
    'long'.repeat(20) + '@example.test',
  ].entries())
    await legacy
      .prepare(
        "INSERT INTO users (id, kind, email, password_hash, created_at, updated_at) VALUES (?, 'member', ?, 'kept-hash', 1, 1)",
      )
      .bind(ids[i], email)
      .run();
  await legacy
    .prepare("INSERT INTO users (id, kind, created_at, updated_at) VALUES ('guest', 'guest', 1, 1)")
    .run();
  await legacy
    .prepare("INSERT INTO sessions VALUES ('session-hash', ?, 1, 9999999999999)")
    .bind(ids[0])
    .run();
  await legacy
    .prepare("INSERT INTO personal_bests VALUES (?, 'sprint', 100, 1)")
    .bind(ids[0])
    .run();
  await legacy
    .prepare(
      "INSERT INTO random_results (user_id, match_id, won, completed_at) VALUES (?, 'match', 1, 1)",
    )
    .bind(ids[0])
    .run();
  await applySql(await readFile('apps/api/migrations/0005_usernames.sql', 'utf8'));
  for (const [i, id] of ids.entries()) {
    const user = await legacy
      .prepare('SELECT username, password_hash FROM users WHERE id = ?')
      .bind(id)
      .first();
    assert.equal(user!.username, i === 0 ? 'alice' : `player-${[...ids].sort().indexOf(id) + 1}`);
    assert.equal(user!.password_hash, 'kept-hash');
  }
  assert.equal(
    (await legacy.prepare("SELECT username FROM users WHERE id = 'guest'").first())!.username,
    null,
  );
  for (const table of ['sessions', 'personal_bests', 'random_results'])
    assert.equal(
      (await legacy
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`)
        .bind(ids[0])
        .first())!.n,
      1,
    );
  const columns = await legacy.prepare('PRAGMA table_info(users)').all();
  assert.ok(!columns.results.some((row) => row.name === 'email'));
  assert.equal((await legacy.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
});

test('room directory hides connection codes and passwords, validates entry and expires listings', async () => {
  const owner = await guest();
  const other = await guest();
  const body = { code: 'ABC234', password: '0123', winsRequired: 3, handicap: null, ...handshake };
  assert.equal((await post('rooms', { ...body, password: '123' }, owner.cookie)).status, 400);
  assert.equal((await post('rooms', body)).status, 401);
  assert.equal((await post('rooms', body, owner.cookie)).status, 200);
  const listing = await mf.dispatchFetch(`${base}/api/v1/rooms`);
  const data = (await listing.json()) as {
    rooms: { id: string; locked: boolean; code?: string; password_hash?: string }[];
  };
  const room = data.rooms[0];
  assert.equal(room.locked, true);
  assert.equal(room.code, undefined);
  assert.equal(room.password_hash, undefined);
  assert.equal((await post('rooms/join', { id: room.id })).status, 403);
  assert.equal((await post('rooms/join', { id: room.id, password: '9999' })).status, 403);
  assert.equal((await post('rooms/join', { id: body.code })).status, 403);
  const joined = await post('rooms/join', { id: room.id, password: '0123' });
  assert.deepEqual(await joined.json(), { code: body.code });
  assert.equal((await post('rooms', body, other.cookie)).status, 409);
  assert.equal((await post('rooms', { code: body.code, renew: true }, other.cookie)).status, 404);
  assert.equal((await post('rooms', { code: body.code, renew: true }, owner.cookie)).status, 200);
  assert.equal((await post('rooms/join', { id: room.id })).status, 403);
  await post('rooms', { code: body.code, remove: true }, other.cookie);
  assert.equal((await post('rooms/join', { id: room.id, password: '0123' })).status, 200);
  await post('rooms', { ...body, password: undefined }, owner.cookie);
  assert.equal((await post('rooms/join', { id: room.id })).status, 200);
  await db.prepare('UPDATE room_directory SET expires_at = 0 WHERE code = ?').bind(body.code).run();
  assert.equal((await post('rooms/join', { id: room.id })).status, 404);
  const expired = await mf.dispatchFetch(`${base}/api/v1/rooms`);
  assert.deepEqual(await expired.json(), { rooms: [] });
  await post('rooms', body, owner.cookie);
  await post('rooms', { code: body.code, remove: true }, owner.cookie);
  assert.equal((await post('rooms/join', { id: body.code, password: '0123' })).status, 404);
});
