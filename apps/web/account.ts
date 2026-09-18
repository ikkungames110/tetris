import type { RatingResult } from '../../packages/protocol/online';
import type { AccountState, RandomResult, Rankings } from '../../packages/protocol/account';
import type { Replay } from '../../packages/core/replay';
import { timeLabel } from './render';
import { renderRankings } from './rankings';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector)!;
class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class AccountUI {
  readonly enabled = import.meta.env.VITE_ACCOUNTS_ENABLED !== 'false';
  state: AccountState | null = null;
  readonly ready: Promise<void>;
  private rankingSnapshot: Rankings | null = null;
  private rankingStatus = 'ランキングを読み込み中…';
  private busy = false;
  private saving = 0;
  private locked = false;
  private registering = false;
  private revision = 0;
  private pending: { replay: Replay; userId: string; ticks: number } | null = null;
  private sprintSaving = new Set<number>();
  private randomSaved = new Set<string>();
  private pendingRandom = new Map<string, RandomResult>();
  private randomSaving = new Set<string>();
  readonly dialog: HTMLDialogElement;

  readonly randomStatus = new Map<string, string>();
  constructor(
    private changed: () => void,
    private randomResult: (result: RatingResult) => void = () => {},
  ) {
    $('#account-tools').innerHTML =
      '<span id="account-name">ゲスト</span><button id="login-open" class="icon-button">ログイン</button>';
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <dialog id="account-dialog" aria-labelledby="account-title">
        <div class="dialog-heading"><h2 id="account-title">ログイン</h2><button class="icon-button" id="account-close" aria-label="ログイン画面を閉じる">✕</button></div>
        <div id="account-tabs" class="mode-switch"><button id="account-login" aria-pressed="true">ログイン</button><button id="account-register" aria-pressed="false">新規登録</button></div>
        <form id="account-form" class="account-form">
          <label>ユーザー名<input id="account-username" type="text" autocomplete="username" maxlength="40" required /></label>
          <label>パスワード<input id="account-password" type="password" autocomplete="current-password" minlength="1" maxlength="128" required /></label>
          <p id="register-hint" class="small muted" hidden>ユーザー名は1〜40文字（空白・@不可、半角英字の大文字・小文字は区別しません）。パスワードは1〜128文字。ゲストの自己ベストを引き継ぎます。登録により<a href="./legal/#about" target="_blank" rel="noopener noreferrer">利用規約</a>に同意し、<a href="./legal/#privacy" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a>を確認したものとします。</p>
          <button id="account-submit" class="primary-button" type="submit">ログイン</button>
        </form>
        <div id="account-member" hidden><p id="account-member-username"></p><button id="account-logout" class="text-button">ログアウト</button></div>
        <p id="account-error" class="account-message" role="status"></p>
      </dialog>`,
    );
    $('#mypage-records').insertAdjacentHTML(
      'beforebegin',
      `
      <section id="mypage-account" hidden><h3>ユーザー名</h3>
        <form id="username-form" class="account-form">
          <label>新しいユーザー名<input id="mypage-username" type="text" autocomplete="username" maxlength="40" required /></label>
          <p class="small muted">1〜40文字。空白・@は使えません。半角英字の大文字・小文字は区別しません。対戦・ランキングにも表示され、変更後は新しい名前でログインします。</p>
          <button id="username-submit" class="text-button" type="submit">ユーザー名を変更</button>
        </form><p id="username-status" class="account-message" role="status"></p>
      </section>`,
    );
    $('#username-form').onsubmit = (event) => {
      event.preventDefault();
      void this.rename();
    };
    this.dialog = $<HTMLDialogElement>('#account-dialog');
    $('#login-open').onclick = () => {
      if (this.locked) return;
      this.switchForm(false);
      $('#account-error').textContent = '';
      this.dialog.showModal();
      this.changed();
      if (this.state?.user.kind !== 'member') $('#account-username').focus();
    };
    $('#account-close').onclick = () => this.close();
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    $('#account-login').onclick = () => this.switchForm(false);
    $('#account-register').onclick = () => this.switchForm(true);
    $('#account-form').onsubmit = (event) => {
      event.preventDefault();
      void this.authenticate();
    };
    $('#account-logout').onclick = () => void this.logout();
    $('#best-retry').onclick = () => {
      const pending = this.pending;
      if (pending) void this.save(pending.replay, pending.userId, pending.ticks);
    };
    $('#mypage-record-retry').onclick = () => {
      for (const result of this.pendingRandom.values()) void this.saveRandom(result, result.userId);
    };
    $('#mypage-record-retry').textContent = '戦績を再送・確認';
    $('#account-tools').hidden = !this.enabled;
    $('#mypage-record-status').textContent = this.enabled
      ? 'プレイ記録を読み込み中…'
      : 'この公開先ではプレイ記録を利用できません。';
    this.render();
    this.ready = this.enabled ? this.initialize() : Promise.resolve();
  }

  lock(value: boolean): void {
    this.locked = value;
    $<HTMLButtonElement>('#login-open').disabled = value || this.busy || this.saving > 0;
    $<HTMLButtonElement>('#username-submit').disabled = value || this.busy || this.saving > 0;
  }
  async identity(): Promise<string | null> {
    await this.ready;
    return this.state?.user.id ?? null;
  }
  private async api(path: string, body?: unknown): Promise<AccountState> {
    let response: Response;
    try {
      response = await fetch(`./api/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiError(0, '接続できませんでした。通信を確認して再度お試しください。');
    }
    if (!response.headers.get('Content-Type')?.includes('application/json'))
      throw new ApiError(
        response.status,
        'アカウント機能に接続できません。時間をおいてお試しください。',
      );
    const data = (await response.json()) as AccountState & { error?: string };
    if (!response.ok) throw new ApiError(response.status, data.error ?? '処理に失敗しました。');
    if (!data.user?.id || !['guest', 'member'].includes(data.user.kind))
      throw new ApiError(0, '応答を読み込めませんでした。');
    return data;
  }
  private apply(state: AccountState): void {
    // A slower response from an earlier save cannot roll back a newer best.
    if (
      state.user.id === this.state?.user.id &&
      this.state.best40 &&
      (!state.best40 || state.best40.ticks > this.state.best40.ticks)
    )
      state.best40 = this.state.best40;
    if (
      state.user.id === this.state?.user.id &&
      this.state.randomStats &&
      state.randomStats?.matches < this.state.randomStats.matches
    )
      state.randomStats = this.state.randomStats;
    if (
      state.user.id === this.state?.user.id &&
      this.state.rating &&
      state.rating &&
      state.rating.matches < this.state.rating.matches
    )
      state.rating = this.state.rating;
    if (state.rankings) {
      this.rankingSnapshot = state.rankings;
      this.rankingStatus = '';
    } else if (state.user.id !== this.state?.user.id) {
      // Logout does not fetch again or leave the previous user's own rank visible.
      if (this.rankingSnapshot) {
        const anonymous = (board: Rankings['sprint']) => ({
          top: board.top.map((entry) => ({ ...entry, isYou: false })),
          mine: null,
        });
        this.rankingSnapshot = {
          sprint: anonymous(this.rankingSnapshot.sprint),
          random: anonymous(this.rankingSnapshot.random),
        };
      } else
        this.rankingStatus = 'ランキングを取得できませんでした。ページを再読み込みしてください。';
    }
    this.state = state;
    this.render();
  }
  private async initialize(): Promise<void> {
    const revision = this.revision;
    try {
      const state = await this.api('session', {});
      if (revision === this.revision) this.apply(state);
    } catch {
      $('#mypage-record-status').textContent =
        'プレイ記録を取得できませんでした。通信を確認し、ページを再読み込みしてください。';
      this.rankingStatus = 'ランキングを取得できませんでした。ページを再読み込みしてください。';
      renderRankings(null, false, this.rankingStatus);
    }
  }
  private switchForm(registering: boolean): void {
    if (this.busy) return;
    this.registering = registering;
    $('#account-title').textContent =
      this.state?.user.kind === 'member' ? 'アカウント' : registering ? '新規登録' : 'ログイン';
    $('#account-submit').textContent = registering ? '登録する' : 'ログイン';
    $('#register-hint').hidden = !registering;
    $('#account-error').textContent = '';
    $<HTMLInputElement>('#account-password').autocomplete = registering
      ? 'new-password'
      : 'current-password';
    for (const [selector, selected] of [
      ['#account-login', !registering],
      ['#account-register', registering],
    ] as const) {
      $(selector).setAttribute('aria-pressed', String(selected));
      $(selector).classList.toggle('selected', selected);
    }
    this.render();
  }
  private setBusy(value: boolean): void {
    this.busy = value;
    for (const element of this.dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button, input',
    ))
      element.disabled = value;
    this.lock(this.locked);
    this.changed();
  }
  private close(): void {
    if (this.busy) return;
    this.dialog.close();
    $<HTMLInputElement>('#account-password').value = '';
    this.changed();
  }
  private async authenticate(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    $('#account-error').textContent = '処理中…';
    try {
      await this.ready;
      this.revision++;
      if (this.registering && !this.state) this.apply(await this.api('session', {}));
      const state = await this.api(this.registering ? 'register' : 'login', {
        username: $<HTMLInputElement>('#account-username').value,
        password: $<HTMLInputElement>('#account-password').value,
      });
      this.pending = null;
      this.pendingRandom.clear();
      this.randomSaved.clear();
      $('#best-status').textContent = '';
      $('#best-retry').hidden = true;
      this.apply(state);
      this.setBusy(false);
      this.close();
    } catch (error) {
      $('#account-error').textContent =
        error instanceof Error ? error.message : 'ログインできませんでした。';
    } finally {
      this.setBusy(false);
    }
  }
  private async rename(): Promise<void> {
    if (this.busy || this.locked || this.saving || this.state?.user.kind !== 'member') return;
    this.setBusy(true);
    $('#username-status').textContent = '変更中…';
    try {
      const state = await this.api('username', {
        username: $<HTMLInputElement>('#mypage-username').value,
      });
      this.apply(state);
      $('#username-status').textContent =
        'ユーザー名を変更しました。次回からこの名前でログインしてください。';
    } catch (error) {
      $('#username-status').textContent =
        error instanceof Error ? error.message : '変更できませんでした。';
    } finally {
      this.setBusy(false);
    }
  }
  private async logout(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.revision++;
    try {
      const state = await this.api('logout', {});
      this.pending = null;
      this.pendingRandom.clear();
      this.randomSaved.clear();
      this.apply(state);
      $('#best-status').textContent = '';
      $('#best-retry').hidden = true;
      this.setBusy(false);
      this.close();
    } catch (error) {
      $('#account-error').textContent =
        error instanceof Error ? error.message : 'ログアウトできませんでした。';
    } finally {
      this.setBusy(false);
    }
  }
  async save(replay: Replay, userId: string | null, ticks: number): Promise<void> {
    if (!this.enabled) return;
    if (!userId) {
      $('#best-status').textContent = 'ユーザー情報を取得できなかったため、この記録は未保存です。';
      return;
    }
    if (userId !== this.state?.user.id) {
      $('#best-status').textContent = 'プレイ開始時からユーザーが変わったため、記録は未保存です。';
      return;
    }
    // 同タイム・遅い記録と、保存中の記録の重複送信はAPIを呼ぶ前に除外する。
    if (
      (this.state.best40 && ticks >= this.state.best40.ticks) ||
      [...this.sprintSaving].some((saving) => saving <= ticks) ||
      (this.pending && this.pending.userId === userId && this.pending.ticks < ticks)
    )
      return;
    const revision = this.revision;
    const pending = { replay, userId, ticks };
    this.sprintSaving.add(ticks);
    this.saving++;
    this.lock(this.locked);
    this.pending = pending;
    $('#best-status').textContent = '記録を保存中…';
    $('#best-retry').hidden = true;
    try {
      const state = await this.api('records/40line', { replay, userId });
      if (revision !== this.revision || this.state?.user.id !== state.user.id) return;
      this.apply(state);
      if (this.pending === pending) {
        this.pending = null;
        $('#best-status').textContent = '保存しました';
      }
    } catch (error) {
      if (revision !== this.revision || this.pending !== pending) return;
      $('#best-status').textContent =
        error instanceof Error ? error.message : '記録を保存できませんでした。';
      $('#best-retry').hidden =
        error instanceof ApiError && [400, 401, 409, 413].includes(error.status);
    } finally {
      this.sprintSaving.delete(ticks);
      this.saving--;
      this.lock(this.locked);
    }
  }
  async saveRandom(result: Omit<RandomResult, 'userId'>, userId: string | null): Promise<void> {
    if (!this.enabled) return;
    if (!userId) {
      $('#mypage-record-status').textContent =
        'ユーザー情報を取得できなかったため、戦績を表示できません。';
      return;
    }
    if (userId !== this.state?.user.id) return;
    if (this.randomSaving.has(result.matchId) || this.randomSaved.has(result.matchId)) return;
    const revision = this.revision;
    const pending = { ...result, userId };
    this.pendingRandom.set(result.matchId, pending);
    this.randomSaving.add(result.matchId);
    this.saving++;
    this.lock(this.locked);
    this.render();
    try {
      let state = await this.api('records/random', pending);
      // Only retry a pending counterpart report, with a bounded delay. Network
      // failures remain manually retryable and never create an endless poll.
      for (const delay of [500, 1500, 3000]) {
        if (!state.randomPending) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (revision !== this.revision || this.state?.user.id !== userId) return;
        state = await this.api('records/random', pending);
      }
      if (revision !== this.revision || this.state?.user.id !== state.user.id) return;
      if (state.randomPending) {
        const status = '戦績を確定しています。マイページから再確認できます。';
        this.randomStatus.set(result.matchId, status);
        $('#mypage-record-status').textContent = status;
        return;
      }
      this.randomStatus.delete(result.matchId);
      this.pendingRandom.delete(result.matchId);
      this.randomSaved.add(result.matchId);
      this.apply(state);
      if (state.randomResult) this.randomResult(state.randomResult);
    } catch (error) {
      if (revision !== this.revision) return;
      const status = error instanceof Error ? error.message : '戦績を保存できませんでした。';
      this.randomStatus.set(result.matchId, status);
      $('#mypage-record-status').textContent = status;
    } finally {
      this.saving--;
      this.randomSaving.delete(result.matchId);
      this.changed();
      this.lock(this.locked);
      $('#mypage-record-retry').hidden = this.pendingRandom.size === 0;
    }
  }
  private render(): void {
    const member = this.state?.user.kind === 'member';
    renderRankings(
      this.rankingSnapshot,
      member,
      this.enabled ? this.rankingStatus : 'この公開先ではランキングを利用できません。',
    );
    $('#random-current-rating').textContent = this.state?.rating
      ? String(this.state.rating.current)
      : '—';
    $('#random-peak-rating').textContent = this.state?.rating
      ? String(this.state.rating.peak)
      : '—';
    $('#random-rating-status').textContent = !this.enabled
      ? 'この公開先ではレートなしの対戦です。'
      : member
        ? '3本先取。双方がログインしている対戦でレートが変動します。'
        : 'ゲストでも対戦できます。ログインするとレートが付きます。';
    $('#mypage-account').hidden = !member || !this.enabled;
    $<HTMLInputElement>('#mypage-username').value = member ? this.state!.user.username! : '';
    $('#account-tools').dataset.kind = member ? 'member' : 'guest';
    $('#account-name').textContent = member ? this.state!.user.username : 'ゲスト';
    $('#account-name').title = member ? this.state!.user.username! : 'ゲスト';
    $('#login-open').textContent = member ? 'アカウント' : 'ログイン';
    $('#account-form').hidden = member;
    $('#account-tabs').hidden = member;
    $('#account-member').hidden = !member;
    $('#account-member-username').textContent = member ? this.state!.user.username : '';
    $('#best-time').textContent = this.state?.best40
      ? timeLabel(this.state.best40.ticks, true)
      : '—';
    $('#best-owner').textContent = member ? '' : 'ゲスト';
    $('#best-owner').hidden = member;
    $('#mypage-best').textContent = this.state?.best40
      ? timeLabel(this.state.best40.ticks, true)
      : '—';
    const stats = this.state?.randomStats;
    $('#mypage-rating').textContent = this.state?.rating ? String(this.state.rating.current) : '—';
    $('#mypage-peak-rating').textContent = this.state?.rating
      ? String(this.state.rating.peak)
      : '—';
    $('#mypage-matches').textContent = stats ? String(stats.matches) : '—';
    $('#mypage-wins').textContent = stats ? String(stats.wins) : '—';
    $('#mypage-win-rate').textContent = stats?.matches
      ? `${((stats.wins / stats.matches) * 100).toFixed(1)}%`
      : '—';
    if (this.state)
      $('#mypage-record-status').textContent = this.pendingRandom.size
        ? '戦績を取得できていない試合があります。'
        : '';
    $('#mypage-record-retry').hidden = this.pendingRandom.size === 0;
  }
}
