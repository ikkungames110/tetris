import type { AccountState } from '../../packages/protocol/account';
import type { Replay } from '../../packages/core/replay';
import { timeLabel } from './render';

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
  private busy = false;
  private saving = 0;
  private locked = false;
  private registering = false;
  private revision = 0;
  private pending: { replay: Replay; userId: string } | null = null;
  readonly dialog: HTMLDialogElement;

  constructor(private changed: () => void) {
    $('#account-tools').innerHTML =
      '<span id="account-name">ゲスト</span><button id="login-open" class="icon-button">ログイン</button>';
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <dialog id="account-dialog" aria-labelledby="account-title">
        <div class="dialog-heading"><h2 id="account-title">ログイン</h2><button class="icon-button" id="account-close" aria-label="ログイン画面を閉じる">✕</button></div>
        <div id="account-tabs" class="mode-switch"><button id="account-login" aria-pressed="true">ログイン</button><button id="account-register" aria-pressed="false">新規登録</button></div>
        <form id="account-form" class="account-form">
          <label>メールアドレス<input id="account-email" type="email" autocomplete="username" maxlength="254" required /></label>
          <label>パスワード<input id="account-password" type="password" autocomplete="current-password" minlength="1" maxlength="128" required /></label>
          <p id="register-hint" class="small muted" hidden>パスワードは1〜128文字。ゲストの自己ベストを引き継ぎます。</p>
          <button id="account-submit" class="primary-button" type="submit">ログイン</button>
        </form>
        <div id="account-member" hidden><p id="account-member-email"></p><button id="account-logout" class="text-button">ログアウト</button></div>
        <p id="account-error" class="account-message" role="status"></p>
      </dialog>`,
    );
    this.dialog = $<HTMLDialogElement>('#account-dialog');
    $('#login-open').onclick = () => {
      if (this.locked) return;
      this.switchForm(false);
      $('#account-error').textContent = '';
      this.dialog.showModal();
      this.changed();
      if (this.state?.user.kind !== 'member') $('#account-email').focus();
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
      if (pending) void this.save(pending.replay, pending.userId);
    };
    $('#account-tools').hidden = !this.enabled;
    this.ready = this.enabled ? this.initialize() : Promise.resolve();
    window.addEventListener('focus', () => {
      if (this.enabled && !this.busy) void this.refresh();
    });
  }

  lock(value: boolean): void {
    this.locked = value;
    $<HTMLButtonElement>('#login-open').disabled = value || this.busy || this.saving > 0;
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
    this.state = state;
    this.render();
  }
  private async initialize(): Promise<void> {
    const revision = this.revision;
    try {
      const state = await this.api('session', {});
      if (revision === this.revision) this.apply(state);
    } catch {
      /* The game remains playable as a guest while the API is unavailable. */
    }
  }
  private async refresh(): Promise<void> {
    await this.ready;
    const revision = this.revision;
    try {
      const state = await this.api('me');
      if (revision === this.revision) this.apply(state);
    } catch (error) {
      if (revision === this.revision && error instanceof ApiError && error.status === 401) {
        this.state = null;
        this.render();
        await this.initialize();
      }
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
        email: $<HTMLInputElement>('#account-email').value,
        password: $<HTMLInputElement>('#account-password').value,
      });
      this.pending = null;
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
  private async logout(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.revision++;
    try {
      this.apply(await this.api('logout', {}));
      this.pending = null;
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
  async save(replay: Replay, userId: string | null): Promise<void> {
    if (!this.enabled) return;
    if (!userId) {
      $('#best-status').textContent = 'ユーザー情報を取得できなかったため、この記録は未保存です。';
      return;
    }
    const revision = this.revision;
    const pending = { replay, userId };
    this.saving++;
    this.lock(this.locked);
    this.pending = pending;
    $('#best-status').textContent = '記録を保存中…';
    $('#best-retry').hidden = true;
    try {
      const state = await this.api('records/40line', pending);
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
      this.saving--;
      this.lock(this.locked);
    }
  }
  private render(): void {
    const member = this.state?.user.kind === 'member';
    $('#account-name').textContent = member ? this.state!.user.email : 'ゲスト';
    $('#account-name').title = member ? this.state!.user.email! : 'ゲスト';
    $('#login-open').textContent = member ? 'アカウント' : 'ログイン';
    $('#account-form').hidden = member;
    $('#account-tabs').hidden = member;
    $('#account-member').hidden = !member;
    $('#account-member-email').textContent = member ? this.state!.user.email : '';
    $('#best-time').textContent = this.state?.best40
      ? timeLabel(this.state.best40.ticks, true)
      : '—';
    $('#best-owner').textContent = member ? '' : 'ゲスト';
  }
}
