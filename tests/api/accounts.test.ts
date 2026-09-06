import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { completedSprint as completed } from '../helpers/sprint';
import type { AccountState } from '../../packages/protocol/account';
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
    }),
  );
  db = await mf.getD1Database('DB');
  const sql = await readFile('apps/api/migrations/0001_accounts.sql', 'utf8');
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
