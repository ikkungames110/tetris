import './style.css';
import { createMatch, stateHash, stepMatch } from '../../packages/core/engine';
import {
  newReplay,
  parseReplay,
  recordTick,
  ReplayPlayer,
  type Replay,
} from '../../packages/core/replay';
import {
  Button,
  RULES,
  type Action,
  type Input,
  type Mode,
  type ClearEffect,
  type ClearObserver,
} from '../../packages/core/types';
import { Sound } from './audio';
import { ClearParticles } from './particles';
import { OnlineClient } from './online';
import { Matchmaker } from './matchmaking';
import { displayMatch, type ServerMessage } from '../../packages/protocol/online';
import {
  ACTION_LABELS,
  bindingLabel,
  captureBinding,
  defaultBindings,
  padName,
  type Pad,
} from './gamepad';
import { InputManager, type Device } from './input';
import { clearLabel, drawBoard, drawPreview, playerSummary, timeLabel } from './render';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector)!;
const playerHTML = (i: number) => `
  <article class="player-panel player-${i}" aria-label="${i + 1}Pの盤面">
    <div class="player-heading"><span class="player-name"><span class="player-dot"></span>PLAYER ${String(i + 1).padStart(2, '0')}</span><span class="device-label" id="device-label-${i}">KEYBOARD</span></div>
    <div class="board-layout">
      <aside class="hold-side"><span class="tiny-label">HOLD</span><canvas id="hold-${i}" width="72" height="62" aria-label="${i + 1}P HOLD"></canvas><span class="hold-hint" id="hold-hint-${i}">C</span><div class="b2b" id="b2b-${i}">B2B</div><div class="ren" id="ren-${i}"></div></aside>
      <div class="matrix-wrap"><canvas class="matrix" id="board-${i}" width="300" height="600" aria-label="${i + 1}P テトリス盤面"></canvas><canvas class="clear-particles" id="particles-${i}" width="300" height="600" aria-hidden="true"></canvas><div class="garbage-track"><div id="garbage-bar-${i}"></div></div><div class="board-overlay" id="board-overlay-${i}"><span>READY</span></div><div class="clear-label" id="clear-${i}"></div></div>
      <aside class="next-side"><span class="tiny-label">NEXT <span class="muted">/ 5</span></span><canvas id="next-${i}" width="72" height="290" aria-label="${i + 1}P NEXT 5個"></canvas><div class="incoming"><span class="tiny-label">INCOMING</span><strong id="incoming-${i}">0</strong></div></aside>
    </div>
    <div class="player-stats"><div><span>LINES</span><strong id="lines-${i}">0</strong></div><div><span>ATTACK</span><strong id="attack-${i}">0</strong></div><div><span>CANCEL</span><strong id="cancel-${i}">0</strong></div><div><span>PIECES / S</span><strong id="pps-${i}">0.00</strong></div></div>
  </article>`;

$('#app').innerHTML = `
  <header class="site-header"><a class="brand" href="./" aria-label="STACK ホーム"><span class="brand-mark"><i></i><i></i><i></i><i></i></span>STACK<span class="brand-sub">対戦テトリス</span></a><div class="header-tools"><span class="connection-status" id="connection-status"><i></i>KEYBOARD READY</span><button class="icon-button" id="sound" title="効果音を切り替える" aria-label="効果音をオン" aria-pressed="false">音 OFF</button><button class="icon-button" id="settings-open">操作設定 <span>↗</span></button></div></header>
  <main>

    <section class="toolbar" aria-label="ゲーム操作"><div class="mode-switch" role="group" aria-label="ゲームモード"><button id="practice" class="selected" aria-pressed="true">ひとりで練習</button><button id="online" aria-pressed="false">オンライン対戦</button></div><div class="match-info"><span id="round-label">PRACTICE</span><span class="separator"></span><time id="timer">00:00</time><strong id="score" hidden>0 : 0</strong></div><div class="match-actions"><button id="pause" class="text-button" disabled>一時停止</button><button id="start" class="primary-button">プレイする <span>↗</span></button></div></section>
    <section id="online-lobby" class="online-lobby" aria-label="オンライン対戦ルーム" hidden>
      <div class="lobby-heading"><h2>オンライン対戦</h2><p>2本先取。対戦中はこのタブを開いたままにしてください。</p></div>
      <details id="p2p-settings"><summary>接続できない場合のTURN設定（任意）</summary><p>携帯回線などで直接つながらない場合は、利用するTURNサービスの接続情報を双方で設定してください。認証情報は保存しません。</p><div class="turn-fields"><label>TURN URL<input id="turn-url" placeholder="turn:relay.example.com:3478" autocomplete="off" /></label><label>ユーザー名<input id="turn-username" autocomplete="off" /></label><label>パスワード<input id="turn-password" type="password" autocomplete="off" /></label></div></details>
      <div id="room-entry" class="room-entry"><div id="room-options" class="room-entry"><button id="room-create" class="primary-button">ルームを作成</button><button id="room-join-open" class="primary-button">ルームに参加</button><button id="match-start" class="primary-button">マッチング待機</button></div><form id="room-join-form" hidden><label for="room-code-input">招待コード</label><input id="room-code-input" maxlength="6" minlength="6" pattern="[A-HJ-NP-Za-hj-np-z2-9]{6}" placeholder="ABC234" autocomplete="off" required /><button class="primary-button" id="room-join" type="submit">参加する</button><button class="text-button" id="room-join-back" type="button">戻る</button></form></div>
      <div id="match-wait" class="room-entry" hidden><p id="match-status" role="status">対戦相手を待っています…</p><button id="match-cancel" class="icon-button">キャンセル</button></div>
      <div id="room-details" class="room-details" hidden><span>招待コード <strong id="room-code"></strong></span><button id="room-copy" class="icon-button">招待リンクをコピー</button><span id="room-seat"></span><button id="room-ready" class="primary-button">準備完了</button></div>
      <p id="online-status" role="status"></p>
    </section>
    <div class="notice" id="notice" role="status" hidden></div>
    <section class="arena practice-mode" id="arena">${playerHTML(0)}
      <div class="versus-divider" id="versus-divider" hidden><span>VS</span><small>FIRST TO 2</small></div>${playerHTML(1)}

    </section>
    <section class="bottom-bar"><div><span class="tiny-label">QUICK CONTROLS</span><p id="quick-controls"><kbd>←</kbd><kbd>→</kbd> 移動 <kbd>↓</kbd> 落下 <kbd>Z</kbd><kbd>X</kbd> 回転 <kbd>Space</kbd> ドロップ <kbd>C</kbd> HOLD</p></div><div class="replay-tools"><button class="text-button" id="replay-save" disabled>リプレイ保存 ↓</button><button class="text-button" id="replay-open">リプレイ再生 ↗</button><input id="replay-file" type="file" accept=".json,application/json" hidden /></div></section>
  </main>
  <dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-heading"><div><h2 id="settings-title">操作設定</h2></div><button class="icon-button" id="settings-close" aria-label="設定を閉じる">✕</button></div><p class="dialog-description">ゲームパッドを接続し、ボタンを押すと自動で選択されます。</p><div id="gamepad-help" class="device-help"></div><div id="connected-pads" aria-label="接続中のゲームパッド"></div><div class="device-selects"><label>自分の操作<select id="device-0"></select></label></div><div class="setting-line"><label><input type="checkbox" id="use-stick" /> 左スティックでも移動する</label><span>十字キーは常に有効</span></div><div class="mapping-heading"><h3>ゲームパッドのボタン</h3></div><p id="mapping-device" class="small muted"></p><div id="mapping-grid" class="mapping-grid"></div><p id="capture-status" class="capture-status" role="status">変更する操作を選び、割り当てたいボタンを押します。</p><p id="pad-live" class="small muted"></p><button id="mapping-reset" class="text-button">標準の割り当てに戻す</button><details class="keyboard-help"><summary>キーボードの操作を見る</summary><table><thead><tr><th>操作</th><th>キー</th></tr></thead><tbody><tr><td>移動 / 落下</td><td>← → / ↓</td></tr><tr><td>左 / 右回転</td><td>Z / X</td></tr><tr><td>ハードドロップ</td><td>Space / ↑</td></tr><tr><td>HOLD</td><td>C / 右Shift</td></tr><tr><td>一時停止</td><td>Esc</td></tr></tbody></table></details><p class="small muted">標準設定: 右側ボタンの下・左で左回転、右で右回転、上でドロップ。肩ボタンでHOLD、Start / Menuで開始・一時停止。</p></dialog>
  <dialog id="result-dialog" aria-labelledby="result-title"><span class="eyebrow" id="result-eyebrow">ROUND COMPLETE</span><h2 id="result-title"></h2><p id="result-description"></p><div id="result-stats" class="result-stats"></div><div class="result-actions"><button id="result-home" class="text-button">モード選択へ</button><button id="result-next" class="primary-button">もう一度プレイ ↗</button></div></dialog>
`;

const input = new InputManager();
const sound = new Sound();
let mode: Mode = 'practice';
let onlineMode = false;
let lastOnlineResult = '';
let lastOnlineRound = '';
let lastOnlineEvent = 0;
let lastOnlineUI = '';
let matching = false;
let matchIce: RTCIceServer[] = [];
const online = new OnlineClient(receiveOnline, (message) => {
  $('#online-status').textContent = message;
  updateActions();
});
const matchmaker = new Matchmaker({
  host: () => online.open(undefined, matchIce),
  guest: (code) => online.open(code, matchIce),
  reset: () => {
    online.leave();
    active = false;
    $('#room-details').hidden = true;
    updateActions();
  },
  status: (text) => {
    $('#match-status').textContent = text;
    updateActions();
  },
  error: (text) => {
    home();
    notice(text);
  },
});
let match = createMatch(mode, 42);
let active = false;
let paused = false;
let pauseReason = '';
let replay: Replay | null = null;
let playback: ReplayPlayer | null = null;
let accumulator = 0;
let previousTime = performance.now();
let lastDevices = '';
let capture: { player: number; action: Action; before: Pad; armed: boolean } | null = null;
const settings = $<HTMLDialogElement>('#settings-dialog');
const resultDialog = $<HTMLDialogElement>('#result-dialog');
const leaveButton = document.createElement('button');
leaveButton.id = 'leave';
leaveButton.className = 'text-button';
leaveButton.textContent = '終了';
$('.match-actions').prepend(leaveButton);
leaveButton.onclick = home;
const resultSave = document.createElement('button');
resultSave.className = 'text-button';
resultSave.textContent = 'リプレイ保存 ↓';
$('#result-stats').after(resultSave);
resultSave.onclick = () => $('#replay-save').click();
const boards = [0, 1].map((i) => $<HTMLCanvasElement>(`#board-${i}`));
const holds = [0, 1].map((i) => $<HTMLCanvasElement>(`#hold-${i}`));
const nexts = [0, 1].map((i) => $<HTMLCanvasElement>(`#next-${i}`));

const particles = [0, 1].map((i) => new ClearParticles($<HTMLCanvasElement>(`#particles-${i}`)));
let localClearEffects: (ClearEffect | undefined)[] = [];
let effectsRound = 0;
function resetEffects(): void {
  particles.forEach((p) => p.reset());
  localClearEffects = [];
  effectsRound = match.round;
}
const captureClear: ClearObserver = (player, effect) => {
  const source = playback?.match ?? match;
  localClearEffects[source.players.indexOf(player)] = effect;
};

function notice(message = ''): void {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}
function ready(): boolean {
  const count = 1;
  for (let i = 0; i < count; i++)
    if (input.assignments[i].startsWith('pad:')) {
      const pad = input.selectedPad(i);
      if (!pad) {
        notice(`${i + 1}Pのゲームパッドが見つかりません。操作設定で接続を確認してください。`);
        return false;
      }
      const bindings = input.bindings(pad);
      if (Object.values(bindings).some((list) => !list.length)) {
        notice(`${i + 1}Pのボタン割り当てを操作設定で完了してください。`);
        return false;
      }
    }
  return true;
}

function updateMode(): void {
  $('#arena').classList.toggle('practice-mode', mode === 'practice');
  $('.player-1').hidden = mode === 'practice';
  $('#versus-divider').hidden = mode === 'practice';
  $('#score').hidden = mode === 'practice';
  for (const name of ['practice']) {
    $(`#${name}`).classList.toggle('selected', name === mode && !onlineMode);
    $(`#${name}`).setAttribute('aria-pressed', String(name === mode && !onlineMode));
  }
  $('#online').classList.toggle('selected', onlineMode);
  $('#online').setAttribute('aria-pressed', String(onlineMode));
  $('#online-lobby').hidden = !onlineMode;
  $('#start').hidden = onlineMode;
  $('#pause').hidden = onlineMode;
  $('#round-label').textContent = playback
    ? 'REPLAY'
    : mode === 'practice'
      ? 'PRACTICE'
      : `ROUND ${String(match.round).padStart(2, '0')}`;
}

function start(): void {
  if (onlineMode) return;
  if (!ready()) return;
  mode = 'practice';
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  match = createMatch(mode, seed);
  resetEffects();
  replay = newReplay(mode, seed);
  playback = null;
  active = true;
  paused = false;
  pauseReason = '';
  accumulator = 0;
  resultDialog.close();
  bufferedInputs = [
    { held: 0, pressed: 0 },
    { held: 0, pressed: 0 },
  ];
  notice();
  input.suppressHeld();
  sound.unlock();
  updateMode();
  updateActions();
}

function home(): void {
  matching = false;
  matchmaker.stop();
  online.leave();
  setJoinForm(false);
  $('#match-wait').hidden = true;
  lastDevices = '';
  lastOnlineResult = '';
  lastOnlineRound = '';
  lastOnlineEvent = 0;
  lastOnlineUI = '';
  $('#room-entry').hidden = false;
  $('#room-details').hidden = true;
  $('#p2p-settings').hidden = false;
  $('#online-status').textContent = '';
  active = false;
  paused = false;
  playback = null;
  resultDialog.close();
  match = createMatch(mode, 42);
  resetEffects();
  replay = null;
  accumulator = 0;
  notice();
  input.suppressHeld();
  updateMode();
  updateActions();
}

function setPaused(value: boolean, reason = ''): void {
  if (onlineMode) {
    input.suppressHeld();
    online.input({ held: 0, pressed: 0 }, true);
    return;
  }
  if (!active || resultDialog.open) return;
  paused = value;
  pauseReason = reason;
  accumulator = 0;
  input.suppressHeld();
  updateActions();
}

function updateActions(): void {
  document.body.classList.toggle('playing', active);
  $<HTMLButtonElement>('#pause').disabled = !active || resultDialog.open;
  $('#pause').textContent = paused ? '再開する' : '一時停止';
  $('#start').innerHTML = active ? 'はじめから <span>↗</span>' : 'プレイする <span>↗</span>';
  leaveButton.hidden = !active && !online.busy;
  leaveButton.textContent = onlineMode ? '退室する' : '終了';
  $<HTMLButtonElement>('#online').disabled = active || online.busy || matching;
  $<HTMLButtonElement>('#replay-open').disabled = onlineMode;
  resultSave.hidden = onlineMode;
  $<HTMLButtonElement>('#result-next').disabled = false;
  $<HTMLButtonElement>('#room-create').disabled = online.busy;
  $<HTMLButtonElement>('#room-join').disabled = online.busy;
  $<HTMLButtonElement>('#replay-save').disabled = !replay || !!playback;
  $<HTMLButtonElement>('#practice').disabled = active || online.busy || matching;
  $('#match-wait').hidden = !matching;
  $('#online-status').hidden = matching;
  $('#room-entry').hidden = matching || active;
  $('#p2p-settings').hidden = matching || active;
  $<HTMLButtonElement>('#room-join-open').disabled = online.busy;
  $<HTMLButtonElement>('#match-start').disabled = online.busy;
  $('#room-join-back').hidden = online.busy;
  input.enabled =
    active && !settings.open && !resultDialog.open && (!onlineMode || online.connected);
  if (onlineMode && online.room) updateRoomControls();
}

function showResult(): void {
  const practice = mode === 'practice';
  const finished = match.phase === 'finished';
  $('#result-eyebrow').textContent = practice
    ? '終了'
    : finished
      ? 'MATCH COMPLETE'
      : 'ROUND COMPLETE';
  $('#result-title').textContent = practice
    ? 'ゲーム終了'
    : match.winner === null
      ? 'DRAW'
      : `PLAYER ${match.winner + 1} WIN`;
  $('#result-description').textContent = practice
    ? match.players[0].deathReason
    : `${match.wins[0]} : ${match.wins[1]}${finished ? ' — 決着！' : ' — 2本先取'}`;
  $('#result-stats').replaceChildren();
  for (let i = 0; i < (practice ? 1 : 2); i++) {
    const p = document.createElement('p');
    p.textContent = `${i + 1}P  ${playerSummary(match, i)}`;
    $('#result-stats').append(p);
  }
  $('#result-next').textContent =
    match.phase === 'roundOver' ? '次のラウンドへ ↗' : 'もう一度プレイ ↗';
  resultDialog.showModal();
  updateActions();
  input.suppressHeld();
}

function deviceName(i: number): string {
  if (onlineMode && i !== (online.session?.seat ?? 0)) return '対戦相手';
  const pad = input.selectedPad(0);
  return input.assignments[0] === 'keyboard1' ? 'キーボード' : pad ? padName(pad) : '未接続';
}

function refreshDevices(force = false): void {
  const signature = JSON.stringify([
    input.pads.map((p) => [p.index, p.id, p.mapping]),
    input.assignments,
    input.apiError,
  ]);
  if (!force && signature === lastDevices) return;
  lastDevices = signature;
  for (let i = 0; i < 1; i++) {
    const select = $<HTMLSelectElement>(`#device-${i}`);
    select.replaceChildren();
    const choices = [
      ['keyboard1', 'キーボード（矢印 / Z X）'],
      ...input.pads.map((pad) => [`pad:${pad.index}`, `パッド${pad.index + 1}: ${pad.id}`]),
    ];
    if (!choices.some(([value]) => value === input.assignments[i]))
      choices.push([input.assignments[i], '選択中のパッド（未接続）']);
    for (const [value, name] of choices) select.add(new Option(name, value));
    select.value = input.assignments[i];
    $(`#device-label-${i}`).textContent = deviceName(i);
    updateHoldHint(i);
  }
  for (let i = 0; i < 2; i++) {
    $(`#device-label-${i}`).textContent = deviceName(i);
    updateHoldHint(i);
  }
  const status = $('#connection-status');
  status.textContent = input.pads.length
    ? `${input.pads.length} GAMEPAD CONNECTED`
    : 'KEYBOARD READY';
  status.classList.toggle('connected', input.pads.length > 0);
  $('#gamepad-help').textContent =
    input.apiError ||
    (input.pads.length
      ? '接続したゲームパッドを自分の操作に割り当てます。ボタンは下で変更できます。'
      : 'ゲームパッド待機中。接続後にボタンを押すと、この画面に表示されます。');
  const connectedPads = $('#connected-pads');
  connectedPads.replaceChildren();
  for (const pad of input.pads) {
    const row = document.createElement('div');
    row.className = 'connected-pad';
    const name = document.createElement('span');
    name.textContent = `パッド${pad.index + 1}: ${pad.id}`;
    const actions = document.createElement('div');
    actions.className = 'connected-pad-actions';
    for (let player = 0; player < 1; player++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = '自分の操作に使う';
      button.setAttribute('aria-pressed', String(input.assignments[player] === `pad:${pad.index}`));
      button.onclick = () => assignDevice(player, `pad:${pad.index}`);
      actions.append(button);
    }
    row.append(name, actions);
    connectedPads.append(row);
  }
  $('#quick-controls').textContent = input.assignments[0].startsWith('pad:')
    ? '十字キー 移動 / 落下　右側の下・左 左回転 / 右 右回転 / 上 ドロップ　肩ボタン HOLD'
    : '← → 移動　↓ 落下　Z / X 回転　Space・↑ ドロップ　C HOLD　Esc 一時停止';
  if (onlineMode)
    $('#quick-controls').textContent = $('#quick-controls').textContent!.replace(
      '　Esc 一時停止',
      '',
    );
  renderMappings();
  if (matching && online.room?.connected.every(Boolean) && !online.room.match && ready())
    online.ready();
}

function updateHoldHint(i: number): void {
  if (onlineMode && online.session && i !== online.session.seat) {
    $(`#hold-hint-${i}`).textContent = '—';
    return;
  }
  const slot = 0;
  const pad = input.selectedPad(slot);
  $(`#hold-hint-${i}`).textContent = pad
    ? input.bindings(pad).hold.map(bindingLabel).join(' / ') || '未設定'
    : input.assignments[slot] === 'keyboard1'
      ? 'C'
      : '—';
}

function renderMappings(): void {
  for (let player = 0; player < 2; player++) updateHoldHint(player);
  const i = 0;
  const pad = input.selectedPad(i);
  const container = $('#mapping-grid');
  container.replaceChildren();
  $('#mapping-device').textContent = pad
    ? `${pad.id}${pad.mapping === 'standard' ? '' : ' — 汎用配置。合わないボタンは変更してください。'}`
    : '上でゲームパッドを選ぶと、ボタンを変更できます。';
  $<HTMLButtonElement>('#mapping-reset').disabled = !pad;
  for (const action of Object.keys(Button) as Action[]) {
    const row = document.createElement('div');
    row.className = 'mapping-row';
    const label = document.createElement('span');
    label.textContent = ACTION_LABELS[action];
    const button = document.createElement('button');
    button.disabled = !pad;
    button.dataset.action = action;
    button.textContent = pad
      ? input.bindings(pad)[action].map(bindingLabel).join(' / ') || '未設定'
      : '—';
    button.onclick = () => {
      if (!pad) return;
      capture = { player: i, action, before: copyPad(pad), armed: false };
      $('#capture-status').textContent =
        `${ACTION_LABELS[action]}: いったん離してから、割り当てるボタン・方向を押してください。Escでキャンセル。`;
      container
        .querySelectorAll('button')
        .forEach((b) => b.classList.toggle('capturing', b === button));
    };
    row.append(label, button);
    container.append(row);
  }
}

function copyPad(pad: Pad): Pad {
  return {
    id: pad.id,
    index: pad.index,
    mapping: pad.mapping,
    connected: pad.connected,
    buttons: pad.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
    axes: [...pad.axes],
  };
}

function pollMapping(): void {
  if (!settings.open) return;
  const i = 0;
  const pad = input.selectedPad(i);
  $('#pad-live').textContent = pad
    ? `入力: ${
        pad.buttons
          .map((b, index) => (b.pressed ? `B${index}` : ''))
          .filter(Boolean)
          .join('  ') || '—'
      }`
    : '';
  if (!capture) return;
  const current = input.selectedPad(capture.player);
  if (!current) {
    capture = null;
    $('#capture-status').textContent = 'パッドが切断されました。接続し直してください。';
    renderMappings();
    return;
  }
  if (!capture.armed) {
    if (!current.buttons.some((b) => b.pressed || b.value >= 0.5)) {
      capture.armed = true;
      capture.before = copyPad(current);
    }
    return;
  }
  const binding = captureBinding(capture.before, current);
  if (binding) {
    const bindings = structuredClone(input.bindings(current));
    bindings[capture.action] = [binding];
    input.saveBindings(current, bindings);
    $('#capture-status').textContent =
      `${ACTION_LABELS[capture.action]}を ${bindingLabel(binding)} に変更しました。`;
    capture = null;
    input.suppressHeld();
    renderMappings();
  }
}

const renderElements = new Map<string, HTMLElement>();
function renderElement(selector: string): HTMLElement {
  let element = renderElements.get(selector);
  if (!element) {
    element = $(selector);
    renderElements.set(selector, element);
  }
  return element;
}
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function render(now: number): void {
  if (effectsRound !== match.round) resetEffects();
  for (let i = 0; i < (mode === 'practice' ? 1 : 2); i++) {
    const predicted =
      onlineMode && online.connected && match.phase === 'playing' && online.session?.seat === i
        ? online.prediction.player
        : null;
    const player = predicted ?? match.players[i];
    const tick = predicted ? online.prediction.tick : match.tick;
    drawBoard(boards[i], player);
    particles[i].update(
      onlineMode
        ? predicted
          ? online.prediction.clearEffect
          : online.room?.match?.players[i].clearEffect
        : localClearEffects[i],
      now,
      tick,
    );
    drawPreview(holds[i], player.hold ? [player.hold] : [], player.holdUsed);
    drawPreview(nexts[i], player.next);
    const incoming = player.incoming.reduce((total, attack) => total + attack.lines, 0);
    setText(renderElement(`#incoming-${i}`), String(incoming));
    renderElement(`#incoming-${i}`).classList.toggle('danger', incoming > 0);
    renderElement(`#garbage-bar-${i}`).style.height = `${Math.min(100, incoming * 5)}%`;
    setText(renderElement(`#lines-${i}`), String(player.stats.lines));
    setText(renderElement(`#attack-${i}`), String(player.stats.sent));
    setText(renderElement(`#cancel-${i}`), String(player.stats.cancelled));
    setText(
      renderElement(`#pps-${i}`),
      (match.roundTicks ? player.stats.pieces / (match.roundTicks / 60) : 0).toFixed(2),
    );
    renderElement(`#b2b-${i}`).classList.toggle('on', player.b2b);
    setText(renderElement(`#ren-${i}`), player.ren > 0 ? `${player.ren} REN` : '');
    setText(renderElement(`#clear-${i}`), clearLabel(player, tick));
    const overlay = renderElement(`#board-overlay-${i}`);
    const text =
      onlineMode && active && !online.connected
        ? 'CONNECTING'
        : onlineMode && active && !online.room?.match
          ? 'WAITING'
          : !active
            ? 'READY'
            : paused
              ? 'PAUSED'
              : match.phase === 'countdown'
                ? String(Math.ceil(match.countdown / 60))
                : '';
    const subtitleText =
      onlineMode && active && !online.connected
        ? '再接続中・対戦は進行します'
        : onlineMode && active && !online.room?.match
          ? '双方の準備完了を待っています'
          : !active
            ? '上のボタンからスタート'
            : paused
              ? pauseReason || 'Esc / OPTIONS で再開'
              : '';
    const overlayKey = `${text}:${subtitleText}`;
    if (overlay.dataset.state === overlayKey) continue;
    overlay.dataset.state = overlayKey;
    overlay.hidden = !text;
    overlay.replaceChildren();
    if (text) {
      const title = document.createElement('span');
      title.textContent = text;
      overlay.append(title);
      const subtitle = document.createElement('small');
      subtitle.textContent = subtitleText;
      overlay.append(subtitle);
    }
  }
  setText(renderElement('#timer'), timeLabel(match.roundTicks));
  setText(renderElement('#score'), `${match.wins[0]} : ${match.wins[1]}`);
}

function frame(now: number): void {
  const delta = now - previousTime;
  previousTime = now;
  input.poll();
  refreshDevices();
  pollMapping();
  if (
    active &&
    !onlineMode &&
    !playback &&
    !paused &&
    !resultDialog.open &&
    input.assignments
      .slice(0, mode === 'practice' ? 1 : 2)
      .some((device, i) => device.startsWith('pad:') && !input.selectedPad(i))
  )
    setPaused(true, 'ゲームパッドが切断されました。接続または操作設定を確認してください。');
  if (delta > 250 && !onlineMode && active && !paused && !resultDialog.open)
    setPaused(true, '画面の更新が止まったため、一時停止しました。');
  const controllerInputs = input.consume();
  const pausePressed = controllerInputs
    .slice(0, mode === 'practice' ? 1 : 2)
    .some((p) => p.pressed & Button.pause);
  if (!onlineMode && pausePressed && !settings.open) {
    if (resultDialog.open) $('#result-next').click();
    else if (!active) start();
    else if (paused ? playback || ready() : true) setPaused(!paused);
  }
  if (onlineMode) {
    online.input(
      active && !settings.open && !resultDialog.open && !document.hidden
        ? controllerInputs[0]
        : { held: 0, pressed: 0 },
    );
  }
  if (!onlineMode && active && !paused && !settings.open && !resultDialog.open) {
    accumulator += Math.min(delta, 100);
    // Edges survive render frames with no simulation tick (e.g. 144 Hz displays).
    bufferedInputs = controllerInputs.map((p, i) => ({
      held: p.held,
      pressed: bufferedInputs[i].pressed | (p.pressed & ~Button.pause),
    })) as [Input, Input];
    while (accumulator >= 1000 / RULES.tickRate) {
      accumulator -= 1000 / RULES.tickRate;
      if (playback) {
        try {
          playback.step(captureClear);
          match = playback.match;
        } catch (error) {
          notice(error instanceof Error ? error.message : '再生できませんでした。');
          active = false;
          updateActions();
          break;
        }
        if (playback.done) {
          notice(
            playback.valid
              ? 'リプレイ再生完了。記録と盤面の一致を確認しました。'
              : 'リプレイの検証値が一致しませんでした。',
          );
          active = false;
          updateActions();
          break;
        }
      } else {
        recordTick(replay!, bufferedInputs);
        stepMatch(match, bufferedInputs, RULES, captureClear);
        for (const event of match.events) sound.play(event.type, event.amount);
      }
      bufferedInputs = bufferedInputs.map((p) => ({ held: p.held, pressed: 0 })) as [Input, Input];
      if (!playback && (match.phase === 'roundOver' || match.phase === 'finished')) {
        showResult();
        break;
      }
    }
  } else {
    accumulator = 0;
    bufferedInputs = [
      { held: 0, pressed: 0 },
      { held: 0, pressed: 0 },
    ];
  }
  render(now);
  requestAnimationFrame(frame);
}
let bufferedInputs: [Input, Input] = [
  { held: 0, pressed: 0 },
  { held: 0, pressed: 0 },
];

$('#start').onclick = start;
$('#pause').onclick = () => {
  if (paused && !playback && !ready()) return;
  setPaused(!paused);
};
$('#practice').onclick = () => {
  if (active || matching || online.busy) return;
  onlineMode = false;
  mode = 'practice';
  home();
};
$('#settings-open').onclick = () => {
  if (active) setPaused(true);
  settings.showModal();
  capture = null;
  input.poll();
  refreshDevices(true);
  renderMappings();
  updateActions();
};
const closeSettings = () => {
  capture = null;
  settings.close();
  input.suppressHeld();
  updateActions();
};
$('#settings-close').onclick = closeSettings;
settings.addEventListener('cancel', (event) => {
  event.preventDefault();
  if (capture) {
    capture = null;
    renderMappings();
    $('#capture-status').textContent = '割り当てをキャンセルしました。';
  } else closeSettings();
});
function assignDevice(player: number, device: Device): void {
  input.assignments[player] = device;
  capture = null;
  input.suppressHeld();
  refreshDevices(true);
  $('#capture-status').textContent = '変更する操作を選び、割り当てたいボタンを押します。';
  notice();
}
for (let i = 0; i < 1; i++)
  $<HTMLSelectElement>(`#device-${i}`).onchange = (event) =>
    assignDevice(i, (event.target as HTMLSelectElement).value as Device);
$<HTMLInputElement>('#use-stick').checked = input.sticks;
$('#use-stick').onchange = (event) => {
  input.sticks = (event.target as HTMLInputElement).checked;
  try {
    localStorage.setItem('stack-stick', String(input.sticks));
  } catch {
    /* Optional persistence. */
  }
};
$('#mapping-reset').onclick = () => {
  const pad = input.selectedPad(0);
  if (pad) input.saveBindings(pad, defaultBindings(pad));
  capture = null;
  renderMappings();
  $('#capture-status').textContent = '割り当てを初期状態に戻しました。';
};
$('#sound').onclick = () => {
  sound.enabled = !sound.enabled;
  sound.unlock();
  $('#sound').textContent = `音 ${sound.enabled ? 'ON' : 'OFF'}`;
  $('#sound').setAttribute('aria-pressed', String(sound.enabled));
  $('#sound').setAttribute('aria-label', `効果音を${sound.enabled ? 'オフ' : 'オン'}`);
};
$('#result-home').onclick = home;
$('#result-next').onclick = () => {
  if (onlineMode) {
    if (!online.session) home();
    else if (ready()) online.ready();
    return;
  }
  start();
};
resultDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  home();
});
window.addEventListener('blur', () => setPaused(true, 'ウィンドウが非アクティブになりました。'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true, 'タブが非表示になりました。');
});
window.addEventListener('keydown', (event) => {
  if (
    event.code === 'Enter' &&
    !event.repeat &&
    !settings.open &&
    !resultDialog.open &&
    !active &&
    !onlineMode &&
    !(event.target instanceof HTMLButtonElement)
  ) {
    event.preventDefault();
    start();
  }
});
$('#replay-save').onclick = () => {
  if (!replay || playback) return;
  const data = { ...replay, finalHash: stateHash(match) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `stack-${match.seed}-${match.tick}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#replay-open').onclick = () => {
  if (onlineMode) return;
  if (active) setPaused(true);
  $<HTMLInputElement>('#replay-file').click();
};
$('#replay-file').onchange = async (event) => {
  if (onlineMode) return;
  const fileInput = event.target as HTMLInputElement;
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('リプレイは5 MB以下にしてください。');
    playback = new ReplayPlayer(parseReplay(await file.text()));
    match = playback.match;
    resetEffects();
    mode = match.mode;
    replay = null;
    active = true;
    paused = false;
    accumulator = 0;
    input.suppressHeld();
    notice('リプレイを再生しています。');
    updateMode();
    updateActions();
  } catch (error) {
    notice(error instanceof Error ? error.message : 'リプレイを読み込めませんでした。');
  }
  fileInput.value = '';
};

function updateRoomControls(): void {
  const room = online.room;
  const session = online.session;
  if (!room || !session) return;
  const waiting = !room.match;
  const prepared = room.ready[session.seat];
  setText($('#room-ready'), prepared ? '相手の準備を待っています…' : '準備完了');
  $<HTMLButtonElement>('#room-ready').disabled = !waiting || prepared || !online.connected;
  $('#room-ready').hidden = !waiting || matching;
  if (room.match && ['roundOver', 'finished'].includes(room.match.phase)) {
    setText(
      $('#result-next'),
      room.nextRoundIn === null
        ? '相手の再接続を待っています…'
        : `次の${room.match.phase === 'finished' ? '試合' : 'ラウンド'}まで ${room.nextRoundIn}秒`,
    );
    $<HTMLButtonElement>('#result-next').disabled = true;
  }
}

function receiveOnline(message: ServerMessage): void {
  if (message.type === 'joined') {
    active = true;
    paused = false;
    replay = null;
    playback = null;
    $('#room-entry').hidden = true;
    $('#room-details').hidden = matching;
    if (matching && message.seat === 0) matchmaker.offer(message.code);
    $('#p2p-settings').hidden = true;
    $('#room-code').textContent = message.code;
    $('#room-seat').textContent = `あなたは ${message.seat + 1}P`;
    refreshDevices(true);
    input.suppressHeld();
    updateMode();
    updateActions();
  } else if (message.type === 'room') {
    if (matching && message.match) {
      matching = false;
      matchmaker.stop();
      $('#room-details').hidden = false;
    } else if (
      matching &&
      message.connected.every(Boolean) &&
      !message.ready[online.session!.seat] &&
      ready()
    ) {
      online.ready();
    }
    if (message.match) {
      const key = `${message.matchId}:${message.match.round}`;
      if (key !== lastOnlineRound) {
        lastOnlineRound = key;
        resetEffects();
        lastOnlineEvent = 0;
        resultDialog.close();
        input.suppressHeld();
      }
      match = displayMatch(message.match);
      for (const event of match.events)
        if (event.id > lastOnlineEvent) {
          sound.play(event.type, event.amount);
          lastOnlineEvent = event.id;
        }
      const resultKey = `${key}:${match.phase}`;
      if (['roundOver', 'finished'].includes(match.phase) && lastOnlineResult !== resultKey) {
        lastOnlineResult = resultKey;
        settings.close();
        showResult();
      }
    }
    const count = message.connected.filter(Boolean).length;
    setText(
      $('#online-status'),
      count < 2
        ? message.match
          ? '相手の再接続を待っています（10秒）。対戦は進行します。'
          : '相手の入室を待っています。招待コードまたはリンクを共有してください。'
        : !message.match
          ? `2人が入室しています。準備完了 ${message.ready.filter(Boolean).length} / 2`
          : `P2P対戦中 · あなたは ${online.session!.seat + 1}P · ${online.isHost ? 'ホスト' : `通信 ${online.latency} ms`}`,
    );
    const uiKey = `${message.matchId}:${message.match?.round}:${message.match?.phase}:${message.connected}:${message.ready}:${message.nextRoundIn}`;
    if (uiKey !== lastOnlineUI) {
      lastOnlineUI = uiKey;
      updateMode();
      updateActions();
    }
  } else if (message.type === 'closed') {
    matching = false;
    matchmaker.stop();
    settings.close();
    resultDialog.close();
    if (active) {
      match.phase = 'finished';
      match.winner = message.winner;
      showResult();
      $('#result-title').textContent =
        message.winner === null ? '対戦を終了しました' : `PLAYER ${message.winner + 1} WIN`;
      $('#result-description').textContent = message.reason;
      $('#result-next').textContent = 'ルーム選択へ';
    } else notice(message.reason);
    $('#online-status').textContent = message.reason;
    updateActions();
  } else if (message.type === 'error') {
    home();
    notice(message.message);
  }
}

$('#online').onclick = () => {
  if (active || matching || online.busy) return;
  onlineMode = true;
  mode = 'versus';
  home();
};
function turnServers(): RTCIceServer[] | null {
  const urls = $<HTMLInputElement>('#turn-url').value.trim();
  if (!urls) return [];
  if (!/^turns?:[^\s/]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/.test(urls)) {
    notice('TURN URLは turn:host:port または turns:host:port の形式で入力してください。');
    return null;
  }
  return [
    {
      urls,
      username: $<HTMLInputElement>('#turn-username').value,
      credential: $<HTMLInputElement>('#turn-password').value,
    },
  ];
}
function setJoinForm(open: boolean): void {
  $('#room-options').hidden = open;
  $('#room-join-form').hidden = !open;
  if (open) $<HTMLInputElement>('#room-code-input').focus();
}
$('#room-join-open').onclick = () => setJoinForm(true);
$('#room-join-back').onclick = () => {
  setJoinForm(false);
  $('#room-join-open').focus();
};
$('#match-start').onclick = () => {
  if (online.busy || !ready()) return;
  const servers = turnServers();
  if (!servers) return;
  home();
  matching = true;
  matchIce = servers;
  sound.unlock();
  matchmaker.start(servers);
  updateActions();
};
$('#match-cancel').onclick = home;
$('#room-create').onclick = () => {
  if (!ready()) return;
  notice();
  sound.unlock();
  const servers = turnServers();
  if (servers) online.open(undefined, servers);
};
$('#room-join-form').onsubmit = (event) => {
  event.preventDefault();
  if (!ready() || online.busy) return;
  notice();
  sound.unlock();
  const servers = turnServers();
  if (servers)
    online.open($<HTMLInputElement>('#room-code-input').value.trim().toUpperCase(), servers);
};
$('#room-ready').onclick = () => {
  if (ready()) {
    input.suppressHeld();
    online.ready();
  }
};
$('#room-copy').onclick = async () => {
  if (!online.session) return;
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', online.session.code);
  try {
    await navigator.clipboard.writeText(url.href);
    notice('招待リンクをコピーしました。');
  } catch {
    notice(`招待リンク: ${url.href}`);
  }
};
const invitedRoom = new URL(location.href).searchParams.get('room');
if (invitedRoom && /^[A-HJ-NP-Z2-9]{6}$/i.test(invitedRoom)) {
  onlineMode = true;
  mode = 'versus';
  match = createMatch(mode, 42);
  resetEffects();
  $<HTMLInputElement>('#room-code-input').value = invitedRoom.toUpperCase();
  setJoinForm(true);
}
if (online.restore()) {
  onlineMode = true;
  mode = 'versus';
  active = true;
}
updateMode();
refreshDevices();
updateActions();
requestAnimationFrame(frame);
