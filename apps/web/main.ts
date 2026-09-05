import './style.css';
import { createMatch, nextRound, stateHash, stepMatch } from '../../packages/core/engine';
import {
  newReplay,
  parseReplay,
  recordTick,
  ReplayPlayer,
  type Replay,
} from '../../packages/core/replay';
import { Button, RULES, type Action, type Input, type Mode } from '../../packages/core/types';
import { Sound } from './audio';
import {
  ACTION_LABELS,
  bindingLabel,
  captureBinding,
  emptyBindings,
  standardBindings,
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
      <div class="matrix-wrap"><canvas class="matrix" id="board-${i}" width="300" height="600" aria-label="${i + 1}P テトリス盤面"></canvas><div class="garbage-track"><div id="garbage-bar-${i}"></div></div><div class="board-overlay" id="board-overlay-${i}"><span>READY</span></div><div class="clear-label" id="clear-${i}"></div></div>
      <aside class="next-side"><span class="tiny-label">NEXT <span class="muted">/ 5</span></span><canvas id="next-${i}" width="72" height="290" aria-label="${i + 1}P NEXT 5個"></canvas><div class="incoming"><span class="tiny-label">INCOMING</span><strong id="incoming-${i}">0</strong></div></aside>
    </div>
    <div class="player-stats"><div><span>LINES</span><strong id="lines-${i}">0</strong></div><div><span>ATTACK</span><strong id="attack-${i}">0</strong></div><div><span>CANCEL</span><strong id="cancel-${i}">0</strong></div><div><span>PIECES / S</span><strong id="pps-${i}">0.00</strong></div></div>
  </article>`;

$('#app').innerHTML = `
  <header class="site-header"><a class="brand" href="./" aria-label="STACK ホーム"><span class="brand-mark"><i></i><i></i><i></i><i></i></span>STACK<span class="brand-sub">対戦テトリス</span></a><div class="header-tools"><span class="connection-status" id="connection-status"><i></i>KEYBOARD READY</span><button class="icon-button" id="sound" title="効果音を切り替える" aria-label="効果音をオン" aria-pressed="false">音 OFF</button><button class="icon-button" id="settings-open">操作設定 <span>↗</span></button></div></header>
  <main>
    <div class="page-heading"><div><p class="eyebrow">A LITTLE FOCUS. A BETTER STACK.</p><h1>積んで、つないで、<em>送り返す。</em></h1><p class="page-description">いつもの操作で、もう一戦。キーボードでも、コントローラーでも。</p></div><span class="version-tag">LOCAL PLAY <i>01</i></span></div>
    <section class="toolbar" aria-label="ゲーム操作"><div class="mode-switch" role="group" aria-label="ゲームモード"><button id="practice" class="selected" aria-pressed="true">ひとりで練習</button><button id="versus" aria-pressed="false">ふたりで対戦 <span>1 VS 1</span></button></div><div class="match-info"><span id="round-label">PRACTICE</span><span class="separator"></span><time id="timer">00:00</time><strong id="score" hidden>0 : 0</strong></div><div class="match-actions"><button id="pause" class="text-button" disabled>一時停止</button><button id="start" class="primary-button">プレイする <span>↗</span></button></div></section>
    <div class="notice" id="notice" role="status" hidden></div>
    <section class="arena practice-mode" id="arena">${playerHTML(0)}
      <div class="versus-divider" id="versus-divider" hidden><span>VS</span><small>FIRST TO 2</small></div>${playerHTML(1)}
      <aside class="playbook" id="playbook"><div class="playbook-top"><span class="eyebrow">MAKE EVERY PIECE COUNT</span><h2>次の一手を、<br>じっくり。</h2><p>7種類のミノが1巡する。<br>先を読んで、自分のリズムをつくろう。</p></div><div class="tip"><span class="tip-number">01</span><div><h3>HOLD を味方に</h3><p>使いたいミノを1個キープ。<br>いまのミノを置くと、また交換できます。</p></div></div><div class="tip"><span class="tip-number">02</span><div><h3>つなげて、REN</h3><p>続けてラインを消すと攻撃力アップ。<br>途中で置くだけのターンがあるとリセット。</p></div></div><div class="tip"><span class="tip-number">03</span><div><h3>T-SPIN で切り返す</h3><p>Tミノを回転でねじ込む。<br>2ライン消去で、4ライン分の攻撃に。</p></div></div><div class="practice-footnote"><span>✦</span>練習モードではおじゃまは来ません。<br>ATTACK は相殺後の攻撃量を記録します。</div></aside>
    </section>
    <section class="bottom-bar"><div><span class="tiny-label">QUICK CONTROLS</span><p id="quick-controls"><kbd>←</kbd><kbd>→</kbd> 移動 <kbd>↓</kbd> 落下 <kbd>Z</kbd><kbd>X</kbd> 回転 <kbd>Space</kbd> ドロップ <kbd>C</kbd> HOLD</p></div><div class="replay-tools"><button class="text-button" id="replay-save" disabled>リプレイ保存 ↓</button><button class="text-button" id="replay-open">リプレイ再生 ↗</button><input id="replay-file" type="file" accept=".json,application/json" hidden /></div></section>
    <footer><span><i class="live-dot"></i>60 Hz · SRS · 7-BAG · NEXT 5</span><span>DUALSHOCK 4 対応 / ローカル対戦</span></footer>
  </main>
  <dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-heading"><div><span class="eyebrow">YOUR CONTROLS</span><h2 id="settings-title">操作設定</h2></div><button class="icon-button" id="settings-close" aria-label="設定を閉じる">✕</button></div><p class="dialog-description">DualShock 4 をUSBまたはBluetoothで接続して、どれかのボタンを押してください。</p><div id="gamepad-help" class="device-help"></div><div class="device-selects"><label>PLAYER 01<select id="device-0"></select></label><label>PLAYER 02<select id="device-1"></select></label></div><p class="muted small">ふたり対戦では別々の入力デバイスを選びます。1台のキーボードでも遊べます。</p><div class="setting-line"><label><input type="checkbox" id="use-stick" /> 左スティックでも移動する</label><span>十字キーは常に有効</span></div><div class="mapping-heading"><h3>ゲームパッドのボタン</h3><select id="mapping-player" aria-label="ボタン変更するプレイヤー"><option value="0">PLAYER 01</option><option value="1">PLAYER 02</option></select></div><p id="mapping-device" class="small muted"></p><div id="mapping-grid" class="mapping-grid"></div><p id="capture-status" class="capture-status" role="status">変更する操作を選び、割り当てたいボタンを押します。</p><p id="pad-live" class="small muted"></p><button id="mapping-reset" class="text-button">標準の割り当てに戻す</button><details class="keyboard-help"><summary>キーボードの操作を見る</summary><table><thead><tr><th>操作</th><th>キーボード1</th><th>キーボード2</th></tr></thead><tbody><tr><td>移動 / 落下</td><td>← → / ↓</td><td>A D / S</td></tr><tr><td>左 / 右回転</td><td>Z / X</td><td>Q / E</td></tr><tr><td>ハードドロップ</td><td>Space / ↑</td><td>W</td></tr><tr><td>HOLD</td><td>C / 右Shift</td><td>F</td></tr><tr><td>一時停止</td><td>Esc</td><td>Esc</td></tr></tbody></table></details><p class="small muted">標準設定: × / □ 左回転、○ 右回転、△ / 十字↑ ハードドロップ、L1 / R1 HOLD、OPTIONS 開始・一時停止。</p></dialog>
  <dialog id="result-dialog" aria-labelledby="result-title"><span class="eyebrow" id="result-eyebrow">ROUND COMPLETE</span><h2 id="result-title"></h2><p id="result-description"></p><div id="result-stats" class="result-stats"></div><div class="result-actions"><button id="result-home" class="text-button">モード選択へ</button><button id="result-next" class="primary-button">もう一度プレイ ↗</button></div></dialog>
`;

const input = new InputManager();
const sound = new Sound();
let mode: Mode = 'practice';
let match = createMatch(mode, 42);
let active = false;
let paused = false;
let pauseReason = '';
let replay: Replay | null = null;
let playback: ReplayPlayer | null = null;
let accumulator = 0;
let previousTime = performance.now();
let lastDevices = '';
const manualDevice = [false, false];
const seenPads = new Set<string>();
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

function notice(message = ''): void {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}
function ready(): boolean {
  const count = mode === 'versus' ? 2 : 1;
  if (count === 2 && input.assignments[0] === input.assignments[1]) {
    notice('ふたり対戦では、プレイヤーごとに別の入力デバイスを選んでください。');
    return false;
  }
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
  $('#playbook').hidden = mode !== 'practice';
  $('#score').hidden = mode === 'practice';
  for (const name of ['practice', 'versus']) {
    $(`#${name}`).classList.toggle('selected', name === mode);
    $(`#${name}`).setAttribute('aria-pressed', String(name === mode));
  }
  $('#round-label').textContent = playback
    ? 'REPLAY'
    : mode === 'practice'
      ? 'PRACTICE'
      : `ROUND ${String(match.round).padStart(2, '0')}`;
}

function start(): void {
  if (!ready()) return;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  match = createMatch(mode, seed);
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
  active = false;
  paused = false;
  playback = null;
  resultDialog.close();
  match = createMatch(mode, 42);
  replay = null;
  accumulator = 0;
  notice();
  input.suppressHeld();
  updateMode();
  updateActions();
}

function setPaused(value: boolean, reason = ''): void {
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
  leaveButton.hidden = !active;
  $<HTMLButtonElement>('#replay-save').disabled = !replay || !!playback;
  $<HTMLButtonElement>('#practice').disabled = active;
  $<HTMLButtonElement>('#versus').disabled = active;
  input.enabled = active && !settings.open && !resultDialog.open;
}

function showResult(): void {
  const practice = mode === 'practice';
  const finished = match.phase === 'finished';
  $('#result-eyebrow').textContent = practice
    ? 'NICE STACK'
    : finished
      ? 'MATCH COMPLETE'
      : 'ROUND COMPLETE';
  $('#result-title').textContent = practice
    ? 'おつかれさまでした。'
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
  const device = input.assignments[i];
  if (device === 'keyboard1') return 'KEYBOARD 1';
  if (device === 'keyboard2') return 'KEYBOARD 2';
  const pad = input.selectedPad(i);
  return pad
    ? /054c|dualshock|wireless controller/i.test(pad.id)
      ? 'DUALSHOCK 4'
      : `GAMEPAD ${pad.index + 1}`
    : '未接続';
}

function refreshDevices(): void {
  for (const pad of input.pads) {
    const key = `${pad.index}:${pad.id}`;
    if (!seenPads.has(key)) {
      seenPads.add(key);
      if (!active) {
        const slot = manualDevice.findIndex(
          (manual, i) => !manual && !input.assignments[i].startsWith('pad:'),
        );
        if (slot >= 0) input.assignments[slot] = `pad:${pad.index}`;
      }
    }
  }
  const signature = JSON.stringify([
    input.pads.map((p) => [p.index, p.id, p.mapping]),
    input.assignments,
    input.apiError,
  ]);
  if (signature === lastDevices) return;
  lastDevices = signature;
  for (let i = 0; i < 2; i++) {
    const select = $<HTMLSelectElement>(`#device-${i}`);
    select.replaceChildren();
    const choices = [
      ['keyboard1', 'キーボード1（矢印 / Z X）'],
      ['keyboard2', 'キーボード2（W A S D / Q E）'],
      ...input.pads.map((pad) => [`pad:${pad.index}`, `パッド${pad.index + 1}: ${pad.id}`]),
    ];
    if (!choices.some(([value]) => value === input.assignments[i]))
      choices.push([input.assignments[i], '選択中のパッド（未接続）']);
    for (const [value, name] of choices) select.add(new Option(name, value));
    select.value = input.assignments[i];
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
      ? '接続したパッドを選択できます。ボタンを押すと下に入力が表示されます。'
      : 'ゲームパッド待機中。接続後にボタンを押すと、この画面に表示されます。');
  if (input.assignments[0].startsWith('pad:'))
    $('#quick-controls').textContent =
      '十字キー 移動 / 落下　×・□ 左回転　○ 右回転　△・↑ ドロップ　L1・R1 HOLD（標準）';
  else
    $('#quick-controls').textContent =
      input.assignments[0] === 'keyboard1'
        ? '← → 移動　↓ 落下　Z / X 回転　Space・↑ ドロップ　C HOLD　Esc 一時停止'
        : 'A D 移動　S 落下　Q / E 回転　W ドロップ　F HOLD　Esc 一時停止';
  renderMappings();
}

function updateHoldHint(i: number): void {
  const pad = input.selectedPad(i);
  $(`#hold-hint-${i}`).textContent = pad
    ? input.bindings(pad).hold.map(bindingLabel).join(' / ') || '未設定'
    : input.assignments[i] === 'keyboard1'
      ? 'C'
      : input.assignments[i] === 'keyboard2'
        ? 'F'
        : '—';
}

function renderMappings(): void {
  for (let player = 0; player < 2; player++) updateHoldHint(player);
  const i = Number($<HTMLSelectElement>('#mapping-player').value);
  const pad = input.selectedPad(i);
  const container = $('#mapping-grid');
  container.replaceChildren();
  $('#mapping-device').textContent = pad
    ? `${pad.id}${pad.mapping === 'standard' ? '' : ' — 未標準パッド。各操作を割り当ててください。'}`
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
  const i = Number($<HTMLSelectElement>('#mapping-player').value);
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

function render(): void {
  for (let i = 0; i < (mode === 'practice' ? 1 : 2); i++) {
    const player = match.players[i];
    drawBoard(boards[i], player, match.tick);
    drawPreview(holds[i], player.hold ? [player.hold] : [], player.holdUsed);
    drawPreview(nexts[i], player.next);
    const incoming = player.incoming.reduce((total, attack) => total + attack.lines, 0);
    $(`#incoming-${i}`).textContent = String(incoming);
    $(`#incoming-${i}`).classList.toggle('danger', incoming > 0);
    $(`#garbage-bar-${i}`).style.height = `${Math.min(100, incoming * 5)}%`;
    $(`#lines-${i}`).textContent = String(player.stats.lines);
    $(`#attack-${i}`).textContent = String(player.stats.sent);
    $(`#cancel-${i}`).textContent = String(player.stats.cancelled);
    $(`#pps-${i}`).textContent = (
      match.roundTicks ? player.stats.pieces / (match.roundTicks / 60) : 0
    ).toFixed(2);
    $(`#b2b-${i}`).classList.toggle('on', player.b2b);
    $(`#ren-${i}`).textContent = player.ren > 0 ? `${player.ren} REN` : '';
    $(`#clear-${i}`).textContent = clearLabel(player, match.tick);
    const overlay = $(`#board-overlay-${i}`);
    const text = !active
      ? 'READY'
      : paused
        ? 'PAUSED'
        : match.phase === 'countdown'
          ? String(Math.ceil(match.countdown / 60))
          : '';
    const subtitleText = !active
      ? '上のボタンからスタート'
      : paused
        ? pauseReason || 'Esc / OPTIONS で再開'
        : 'GET YOUR STACK READY';
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
  $('#timer').textContent = timeLabel(match.roundTicks);
  $('#score').textContent = `${match.wins[0]} : ${match.wins[1]}`;
}

function frame(now: number): void {
  const delta = now - previousTime;
  previousTime = now;
  input.poll();
  refreshDevices();
  pollMapping();
  if (
    active &&
    !playback &&
    !paused &&
    !resultDialog.open &&
    input.assignments
      .slice(0, mode === 'practice' ? 1 : 2)
      .some((device, i) => device.startsWith('pad:') && !input.selectedPad(i))
  )
    setPaused(true, 'ゲームパッドが切断されました。接続または操作設定を確認してください。');
  if (delta > 250 && active && !paused && !resultDialog.open)
    setPaused(true, '画面の更新が止まったため、一時停止しました。');
  const controllerInputs = input.consume();
  const pausePressed = controllerInputs
    .slice(0, mode === 'practice' ? 1 : 2)
    .some((p) => p.pressed & Button.pause);
  if (pausePressed && !settings.open) {
    if (resultDialog.open) $('#result-next').click();
    else if (!active) start();
    else if (paused ? playback || ready() : true) setPaused(!paused);
  }
  if (active && !paused && !settings.open && !resultDialog.open) {
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
          playback.step();
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
        stepMatch(match, bufferedInputs);
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
  render();
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
for (const name of ['practice', 'versus'] as Mode[])
  $(`#${name}`).onclick = () => {
    if (active) return;
    mode = name;
    home();
  };
$('#settings-open').onclick = () => {
  if (active) setPaused(true);
  settings.showModal();
  capture = null;
  refreshDevices();
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
for (let i = 0; i < 2; i++)
  $<HTMLSelectElement>(`#device-${i}`).onchange = (event) => {
    input.assignments[i] = (event.target as HTMLSelectElement).value as Device;
    manualDevice[i] = true;
    capture = null;
    input.suppressHeld();
    refreshDevices();
    notice();
  };
$('#mapping-player').onchange = () => {
  capture = null;
  renderMappings();
};
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
  const pad = input.selectedPad(Number($<HTMLSelectElement>('#mapping-player').value));
  if (pad)
    input.saveBindings(pad, pad.mapping === 'standard' ? standardBindings() : emptyBindings());
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
  if (match.phase === 'roundOver') {
    nextRound(match);
    replay!.rounds.push([]);
    paused = false;
    resultDialog.close();
    input.suppressHeld();
    accumulator = 0;
    updateMode();
    updateActions();
  } else start();
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
  if (active) setPaused(true);
  $<HTMLInputElement>('#replay-file').click();
};
$('#replay-file').onchange = async (event) => {
  const fileInput = event.target as HTMLInputElement;
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('リプレイは5 MB以下にしてください。');
    playback = new ReplayPlayer(parseReplay(await file.text()));
    match = playback.match;
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

updateMode();
refreshDevices();
updateActions();
requestAnimationFrame(frame);
