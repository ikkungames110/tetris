import type { D1Database } from '@cloudflare/workers-types';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AccountState, AccountUser } from '../../packages/protocol/account';
import { parseReplay, ReplayPlayer } from '../../packages/core/replay';
import { hashPassword, verifyPassword } from './password';

export interface Env {
  DB: D1Database;
}
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (data: unknown, status = 200, cookie?: string): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });
function cookieName(request: Request): string {
  return new URL(request.url).protocol === 'https:' ? '__Host-stack_session' : 'stack_session';
}
function tokenHash(request: Request): string | null {
  const value = request.headers
    .get('Cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${cookieName(request)}=`))
    ?.split('=')[1];
  return value && /^[a-f0-9]{64}$/.test(value) ? digest(value) : null;
}
function newSession(request: Request, userId: string, env: Env) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  return {
    statement: env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ).bind(digest(token), userId, now, now + SESSION_SECONDS * 1000),
    cookie: `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
  };
}
async function currentUser(request: Request, env: Env): Promise<AccountUser | null> {
  const hash = tokenHash(request);
  if (!hash) return null;
  return env.DB.prepare(
    'SELECT u.id, u.kind, u.email FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?',
  )
    .bind(hash, Date.now())
    .first<AccountUser>();
}
async function account(env: Env, user: AccountUser): Promise<AccountState> {
  const best40 = await env.DB.prepare(
    "SELECT ticks, achieved_at AS achievedAt FROM personal_bests WHERE user_id = ? AND mode = 'sprint'",
  )
    .bind(user.id)
    .first<{ ticks: number; achievedAt: number }>();
  const randomStats = await env.DB.prepare(
    'SELECT COUNT(*) AS matches, COALESCE(SUM(won), 0) AS wins FROM random_results WHERE user_id = ?',
  )
    .bind(user.id)
    .first<{ matches: number; wins: number }>();
  return { user, best40, randomStats: randomStats! };
}
async function limit(env: Env, key: string, maximum: number, windowMs: number): Promise<void> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key_hash, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts`,
  )
    .bind(digest(key), now + windowMs, now, now)
    .first<{ attempts: number }>();
  if (!row || row.attempts > maximum)
    throw new HttpError(429, '操作が続いています。しばらく待ってからお試しください。');
}
async function readJson(request: Request, maximum = 4096): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    throw new HttpError(415, 'JSON形式で送信してください。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '入力がありません。');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new HttpError(413, '送信内容が大きすぎます。');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, '入力を読み込めません。');
  }
}
async function guest(request: Request, env: Env, oldHash: string | null): Promise<Response> {
  const user: AccountUser = { id: randomUUID(), kind: 'guest', email: null };
  const now = Date.now();
  const session = newSession(request, user.id, env);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, kind, created_at, updated_at) VALUES (?, 'guest', ?, ?)",
    ).bind(user.id, now, now),
    session.statement,
    env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(oldHash),
  ]);
  return json(
    { user, best40: null, randomStats: { matches: 0, wins: 0 } } satisfies AccountState,
    200,
    session.cookie,
  );
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/api/v1/health') return json({ ok: true });
  if (request.method === 'GET' && url.pathname === '/api/v1/me') {
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, 'ログイン状態の有効期限が切れました。');
    return json(await account(env, user));
  }
  if (request.method !== 'POST') throw new HttpError(404, 'APIが見つかりません。');
  if (
    request.headers.get('Origin') !== url.origin ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  )
    throw new HttpError(403, 'このページからの操作は許可されていません。');
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    throw new HttpError(415, 'JSON形式で送信してください。');
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const user = await currentUser(request, env);
  if (url.pathname === '/api/v1/session') {
    if (user) return json(await account(env, user));
    await limit(env, `guest:${ip}`, 60, 3600000);
    return guest(request, env, tokenHash(request));
  }
  if (url.pathname === '/api/v1/logout') {
    await limit(env, `guest:${ip}`, 60, 3600000);
    return guest(request, env, tokenHash(request));
  }
  if (url.pathname === '/api/v1/register' || url.pathname === '/api/v1/login') {
    await limit(env, `auth:${ip}`, 30, 900000);
    const body = await readJson(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 1 ||
      password.length > 128
    )
      throw new HttpError(400, 'メールアドレスと1〜128文字のパスワードを入力してください。');
    await limit(env, `email:${email}`, 15, 900000);
    if (url.pathname === '/api/v1/register') {
      if (!user || user.kind !== 'guest')
        throw new HttpError(409, 'ゲスト状態から新規登録してください。');
      const passwordHash = await hashPassword(password);
      const registered: AccountUser = { id: randomUUID(), kind: 'member', email };
      const session = newSession(request, registered.id, env);
      try {
        // Conditional creation plus FK checks keep guest promotion atomic, even
        // if two tabs try to register the same guest at the same time.
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO users (id, kind, email, password_hash, created_at, updated_at) SELECT ?, 'member', ?, ?, created_at, ? FROM users WHERE id = ? AND kind = 'guest'",
          ).bind(registered.id, email, passwordHash, Date.now(), user.id),
          env.DB.prepare(
            'INSERT INTO personal_bests (user_id, mode, ticks, achieved_at) SELECT ?, mode, ticks, achieved_at FROM personal_bests WHERE user_id = ?',
          ).bind(registered.id, user.id),
          env.DB.prepare(
            'INSERT INTO random_results (user_id, match_id, won, completed_at) SELECT ?, match_id, won, completed_at FROM random_results WHERE user_id = ?',
          ).bind(registered.id, user.id),
          env.DB.prepare('DELETE FROM users WHERE id = ? AND kind = ?').bind(user.id, 'guest'),
          session.statement,
        ]);
      } catch (error) {
        if (String(error).includes('constraint'))
          throw new HttpError(
            409,
            'この状態では登録できません。ログインまたはページの更新をお試しください。',
          );
        throw error;
      }
      return json(await account(env, registered), 200, session.cookie);
    }
    const stored = await env.DB.prepare(
      "SELECT id, kind, email, password_hash FROM users WHERE email = ? AND kind = 'member'",
    )
      .bind(email)
      .first<AccountUser & { password_hash: string }>();
    if (!(await verifyPassword(password, stored?.password_hash ?? null)) || !stored)
      throw new HttpError(401, 'メールアドレスまたはパスワードが違います。');
    const session = newSession(request, stored.id, env);
    await env.DB.batch([
      session.statement,
      env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash(request)),
    ]);
    return json(
      await account(env, { id: stored.id, kind: 'member', email: stored.email }),
      200,
      session.cookie,
    );
  }
  if (url.pathname === '/api/v1/records/random') {
    if (!user) throw new HttpError(401, 'ログイン状態の有効期限が切れました。');
    await limit(env, `random:${user.id}`, 30, 60000);
    const body = await readJson(request);
    if (body.userId !== user.id)
      throw new HttpError(409, '対戦開始時からユーザーが変わったため、戦績を保存できません。');
    const { matchId, seat, wins } = body;
    if (
      typeof matchId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(matchId) ||
      (seat !== 0 && seat !== 1) ||
      !Array.isArray(wins) ||
      wins.length !== 2 ||
      !wins.every((value) => Number.isInteger(value) && value >= 0 && value <= 2) ||
      wins.filter((value) => value === 2).length !== 1
    )
      throw new HttpError(400, '決着した対戦の戦績を送信してください。');
    // P2Pの確定結果を本人が保存する。同じ試合の再送は集計を増やさない。
    await env.DB.prepare(
      'INSERT INTO random_results (user_id, match_id, won, completed_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, match_id) DO NOTHING',
    )
      .bind(user.id, matchId, wins[seat] === 2 ? 1 : 0, Date.now())
      .run();
    return json(await account(env, user));
  }
  if (url.pathname === '/api/v1/records/40line') {
    if (!user) throw new HttpError(401, 'ログイン状態の有効期限が切れました。');
    await limit(env, `record:${user.id}`, 30, 60000);
    const body = await readJson(request, 1_000_000);
    if (body.userId !== user.id)
      throw new HttpError(409, 'プレイ開始時からユーザーが変わったため、記録を保存できません。');
    let ticks: number;
    try {
      const replay = parseReplay(JSON.stringify(body.replay));
      if (replay.mode !== 'sprint' || replay.rounds.length !== 1) throw new Error();
      const playback = new ReplayPlayer(replay);
      while (!playback.done) playback.step();
      if (
        !playback.valid ||
        playback.match.phase !== 'finished' ||
        playback.match.winner !== 0 ||
        playback.match.players[0].stats.lines < 40
      )
        throw new Error();
      ticks = playback.match.roundTicks;
    } catch {
      throw new HttpError(400, '40LINEのクリア記録を検証できませんでした。');
    }
    // Atomic minimum: slower, repeated or concurrent submissions never replace a better time.
    await env.DB.prepare(
      `INSERT INTO personal_bests (user_id, mode, ticks, achieved_at) VALUES (?, 'sprint', ?, ?)
      ON CONFLICT(user_id, mode) DO UPDATE SET ticks = excluded.ticks, achieved_at = excluded.achieved_at
      WHERE excluded.ticks < personal_bests.ticks`,
    )
      .bind(user.id, ticks, Date.now())
      .run();
    return json(await account(env, user));
  }
  throw new HttpError(404, 'APIが見つかりません。');
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Never log request bodies, emails, passwords or cookies.
      console.error('Account API failed');
      return json({ error: '処理に失敗しました。時間をおいてお試しください。' }, 500);
    }
  },
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now),
      env.DB.prepare(
        "DELETE FROM users WHERE kind = 'guest' AND created_at < ? AND NOT EXISTS (SELECT 1 FROM sessions WHERE user_id = users.id)",
      ).bind(now - SESSION_SECONDS * 1000),
    ]);
  },
};
